import type { ConnectionStore, RecordView, TypedMaterializedRecord } from '@enbox/browser';
import type {
  AnyRecordCommands, LocalRecordSelection,
} from './record-commands.js';
import type {
  AnyRecordDefinition, EnboxRecordItem, RecordDefinition, RecordKind, RecordSnapshotFor,
} from '../config/record-definition.js';
import type { ConnectionBinding } from './connection-binding.js';

import { copyRecordOptions } from '../config/record-definition.js';
import { EnboxBindingChangedError } from '../errors.js';
import { assertRecordSelection, createRecordCommands, recordTargetKey } from './record-commands.js';
import {
  isConnectionBindingCurrent, selectConnectionBinding, subscribeToConnectionBinding,
} from './connection-binding.js';
import { SelectedRecords, type SelectedRecordSnapshot } from './selected-record-store.js';
import { serializeQuery } from './serialize-query.js';
import { handledQuery } from './query-control.js';

export type EnboxRecordStoreOptions<Selection = unknown> = Readonly<{
  client: ConnectionStore;
  selection?: Selection | null;
  signal?: AbortSignal;
  loadAll?: boolean;
}>;
type RecordOwnerOptions<Selection> = EnboxRecordStoreOptions<Selection> & Readonly<{
  binding?: ConnectionBinding;
  retainWithoutSubscribers?: boolean;
  commandScope?: object;
}>;

/** Typed records over the existing selected-view owner; no independent data cache. */
export class EnboxRecordOwner<T, Selection, Kind extends RecordKind> {
  public readonly client: ConnectionStore;
  public readonly kind: Kind;
  private readonly binding: ConnectionBinding;
  private readonly view: SelectedRecords<TypedMaterializedRecord<T>, LocalRecordSelection>;
  private readonly snapshots = new WeakMap<object, RecordSnapshotFor<T, Selection, Kind>>();
  private commandsValue: AnyRecordCommands<T>;
  private commandToken: object = {};
  private closed = false;
  private retired = false;
  private sourceRows: readonly TypedMaterializedRecord<T>[] | undefined;
  private rows: readonly EnboxRecordItem<T>[] = Object.freeze([]);

  public constructor(
    public readonly definition: RecordDefinition<T, Selection, Kind>,
    private readonly options: RecordOwnerOptions<Selection>,
  ) {
    this.client = options.client;
    this.kind = definition.kind;
    this.binding = options.binding ?? selectConnectionBinding(this.client.getSnapshot());
    const selection = this.normalize(Object.hasOwn(options, 'selection') ? options.selection as Selection | null : definition.options);
    this.commandsValue = this.createCommands(selection, options.commandScope);
    this.view = new SelectedRecords({
      selection,
      open: (query, signal) => {
        const enbox = this.binding.enbox;
        if (enbox === undefined) throw new EnboxBindingChangedError();
        const { enabled: _enabled, recordId, ...nativeQuery } = query;
        const request = this.kind === 'collection'
          ? { ...nativeQuery, pagination: query.pagination ?? { limit: 20 }, materialize: true as const, signal }
          : {
            ...(query.within === undefined ? {} : { within: query.within }),
            filter: recordId === undefined ? {} : { recordId }, pagination: { limit: 1 }, materialize: true as const, signal,
          };
        return enbox.using(definition.protocol).records.observe(definition.path, request) as Promise<RecordView<TypedMaterializedRecord<T>>>;
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      loadAll: options.loadAll === true,
    }, {
      retainWithoutSubscribers: options.retainWithoutSubscribers ?? true,
      enabled: (query) => query.enabled !== false && this.binding.enbox !== undefined && this.binding.session !== undefined,
      bindingGuard: {
        isCurrent: this.isCurrent,
        subscribe: (notify) => subscribeToConnectionBinding(this.client, this.binding, () => {
          if (!isConnectionBindingCurrent(this.client, this.binding)) this.retired = true;
          notify();
        }),
      },
    });
  }

  public readonly getSnapshot = (): RecordSnapshotFor<T, Selection, Kind> => this.project(this.view.getSnapshot());
  public readonly getServerSnapshot = (): RecordSnapshotFor<T, Selection, Kind> => this.project(this.view.getServerSnapshot());
  public readonly subscribe = (notify: () => void): (() => void) => this.view.subscribe(notify);
  public get commands(): RecordSnapshotFor<T, Selection, Kind>['commands'] {
    return this.commandsValue as RecordSnapshotFor<T, Selection, Kind>['commands'];
  }

  public readonly ready = (options: { signal?: AbortSignal } = {}): Promise<
    Extract<RecordSnapshotFor<T, Selection, Kind>, { status: 'ready' }>
  > => {
    const retry = this.view.getSnapshot().retry;
    return this.view.ready(options).then((state) => {
      if (!this.isCurrent() || this.view.getSnapshot().retry !== retry) throw new EnboxBindingChangedError();
      return this.project(state) as Extract<RecordSnapshotFor<T, Selection, Kind>, { status: 'ready' }>;
    });
  };

  public readonly select = (value: Selection | null): Promise<void> => {
    if (!this.isCurrent()) return handledQuery(Promise.reject(new EnboxBindingChangedError()));
    const selection = this.normalize(value);
    const previous = this.view.getSnapshot().selection;
    if (serializeQuery(selection) === serializeQuery(previous)) {
      return handledQuery(this.view.select(previous));
    }
    if (recordTargetKey(this.kind, selection) !== recordTargetKey(this.kind, previous)) {
      this.commandsValue = this.createCommands(selection);
    }
    return handledQuery(this.view.select(selection));
  };

  public readonly retry = (): Promise<void> => this.view.retry();
  public readonly loadMore = (): Promise<void> => this.view.loadMore();
  public readonly updateRecords = (update: (records: readonly EnboxRecordItem<T>[]) => readonly EnboxRecordItem<T>[]): void => {
    if (this.kind !== 'collection' || !this.isCurrent()) throw new EnboxBindingChangedError();
    this.view.updateRecords((nativeRows) => {
      const rows = this.projectRows(nativeRows);
      const next = update(rows);
      return next === rows ? nativeRows : next.map((row) => ({ record: row.record, value: row.data as T }));
    });
  };
  public readonly close = (): Promise<void> => {
    this.closed = true;
    this.sourceRows = undefined;
    this.rows = Object.freeze([]);
    return this.view.close();
  };

  private readonly isCurrent = (): boolean => !this.closed && !this.retired
    && this.options.signal?.aborted !== true && isConnectionBindingCurrent(this.client, this.binding);

  private normalize(value: Selection | null): LocalRecordSelection | null {
    if (value !== null && typeof value !== 'object') throw new TypeError('Record selections must be plain query objects or null.');
    const hasRecordId = value !== null && Object.hasOwn(value as object, 'recordId');
    const selection = copyRecordOptions(value as object | null) as LocalRecordSelection | null;
    if (this.kind === 'singleton' && hasRecordId) throw new TypeError('A singleton selection does not accept recordId.');
    assertRecordSelection(this.definition as AnyRecordDefinition, selection);
    return selection;
  }

  private createCommands(selection: LocalRecordSelection | null, scope?: object): AnyRecordCommands<T> {
    const token = this.commandToken = {};
    return createRecordCommands<T>(this.definition as AnyRecordDefinition, selection, this.binding,
      () => this.commandToken === token && this.isCurrent(), scope);
  }

  private project(raw: SelectedRecordSnapshot<TypedMaterializedRecord<T>, LocalRecordSelection>): RecordSnapshotFor<T, Selection, Kind> {
    const cached = this.snapshots.get(raw);
    if (cached !== undefined) return cached;
    const rows = this.projectRows(raw.records);
    const { records: _records, selection, ...state } = raw;
    const common = {
      ...state, selection, commands: this.commandsValue,
      isReady: raw.status === 'ready', isLoading: raw.status === 'loading',
    };
    const result = this.kind === 'collection' ? Object.freeze({
      ...common, records: rows,
      loadMore: (): Promise<void> => {
        if (!this.isCurrent() || this.view.getSnapshot().retry !== raw.retry) return Promise.reject(new EnboxBindingChangedError());
        return this.view.loadMore();
      },
    }) : (() => {
      const { hasMore: _more, isLoadingMore: _loading, ...single } = common;
      const row = rows[0];
      return Object.freeze({ ...single, data: row?.data, record: row?.record, isMissing: raw.status === 'ready' && row === undefined });
    })();
    const snapshot = result as RecordSnapshotFor<T, Selection, Kind>;
    this.snapshots.set(raw, snapshot);
    return snapshot;
  }

  private projectRows(nativeRows: readonly TypedMaterializedRecord<T>[]): readonly EnboxRecordItem<T>[] {
    if (this.sourceRows !== nativeRows) {
      this.sourceRows = nativeRows;
      this.rows = Object.freeze(nativeRows.map((row) => Object.freeze({
        id: row.record.id, contextId: row.record.contextId, data: row.value, record: row.record,
      })));
    }
    return this.rows;
  }
}

export function isEnboxRecordStore(value: unknown): value is EnboxRecordOwner<unknown, unknown, RecordKind> {
  return value !== null && typeof value === 'object'
    && 'definition' in value && 'client' in value && 'kind' in value
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'subscribe' in value && typeof value.subscribe === 'function';
}
