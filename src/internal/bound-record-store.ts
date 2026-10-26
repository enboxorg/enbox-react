import type { ConnectionStore, RecordPatchInput, RecordQuery, RecordView, TypedMaterializedRecord, TypedProtocol, TypedRecord } from '@enbox/browser';
import type { EnboxRecordItem, RecordCommands } from '../config/record-types.js';
import type { SelectedRecordSnapshot } from './selected-record-store.js';
import type { ConnectionBinding } from './connection-binding.js';

import { DwnResponseError } from '@enbox/browser';

import { EnboxBindingChangedError, EnboxNotConnectedError } from '../errors.js';
import { isConnectionBindingCurrent, selectConnectionBinding, subscribeToConnectionBinding } from './connection-binding.js';
import { isSingletonPath } from './singleton-paths.js';
import { SelectedRecords } from './selected-record-store.js';
import { serializeQuery } from './serialize-query.js';
import { notifyListeners } from './listeners.js';

export type LocalRecordQuery = Omit<RecordQuery<TypedProtocol['definition'], string>, 'within' | 'pagination'> & {
  within?: string; pagination?: { limit: number }; enabled?: boolean;
};
type Commands<T> = RecordCommands<T, `${string}/${string}`, true> & Readonly<{
  set(data: T, scope?: { within?: string }): Promise<EnboxRecordItem<T>>;
}>;
export type BoundRecordOptions = Readonly<{
  client: ConnectionStore; protocol: TypedProtocol; path: string;
  options: LocalRecordQuery | null; signal?: AbortSignal; loadAll?: boolean; pageSize?: number;
}>;

export function copyLocalQuery<Query extends object | null>(value: Query): Query {
  if (value === null) return value;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Record options must be plain query objects.');
  if (Object.hasOwn(value, 'from') || Object.hasOwn(value, 'protocolRole')) {
    throw new TypeError('Enbox record mutations require the local session. Use useRecords for remote or role-authorized reads.');
  }
  return JSON.parse(serializeQuery(value), (_key: string, item: unknown): unknown =>
    item !== null && typeof item === 'object' ? Object.freeze(item) : item) as Query;
}

export function assertParentScope(path: string, within: string | undefined): void {
  const depth = path.split('/').length - 1;
  if (depth === 0 ? within !== undefined : typeof within !== 'string' || !within.trim() || within.split('/').length !== depth) {
    throw new TypeError('Nested record selections require their direct parent context; root records do not accept within.');
  }
}

export function recordItem<T>(record: TypedRecord<T>, data: T): EnboxRecordItem<T> {
  return Object.freeze({ id: record.id, contextId: record.contextId, dateCreated: record.dateCreated,
    timestamp: record.timestamp, data, record });
}

/** Path-bound CRUD and projection over the existing selected-view lifetime. */
export class BoundRecordStore<T> {
  public readonly client: ConnectionStore;
  public readonly protocol: TypedProtocol;
  public readonly path: string;
  private readonly binding: ConnectionBinding;
  private readonly view: SelectedRecords<TypedMaterializedRecord<T>, LocalRecordQuery>;
  private readonly snapshots = new WeakMap<object, SelectedRecordSnapshot<EnboxRecordItem<T>, LocalRecordQuery>>();
  private readonly rows = new WeakMap<readonly TypedMaterializedRecord<T>[], readonly EnboxRecordItem<T>[]>();
  private operations: Commands<T>;
  private token: object = {};
  private recordToken: object = {};
  private closed = false;
  private retired = false;
  private readonly lifetime = new AbortController();
  private readonly selectionListeners = new Set<() => void>();
  /** Read specifications can be compared without activating an unrelated native view. */
  public readonly selectionSource = {
    getSnapshot: () => this.view.getSnapshot().selection,
    subscribe: (notify: () => void): (() => void) => {
      this.selectionListeners.add(notify);
      return () => { this.selectionListeners.delete(notify); };
    },
  };

  public constructor(private readonly config: BoundRecordOptions, retainWithoutSubscribers = true,
    binding = selectConnectionBinding(config.client.getSnapshot()), commandScope?: object) {
    this.client = config.client;
    this.protocol = config.protocol;
    this.path = config.path;
    this.binding = binding;
    const selection = this.normalize(config.options);
    this.operations = this.commandsFor(selection, commandScope);
    this.view = new SelectedRecords({
      selection, loadAll: config.loadAll === true,
      ...(config.signal === undefined ? {} : { signal: config.signal }),
      open: (query, signal) => {
        const { enabled: _enabled, ...request } = query;
        return this.api().observe<string, true>(this.path, { ...request, signal, materialize: true, pagination: query.pagination! }) as Promise<RecordView<TypedMaterializedRecord<T>>>;
      },
    }, {
      retainWithoutSubscribers,
      enabled: (query) => query.enabled !== false && this.binding.enbox !== undefined && this.binding.session !== undefined,
      bindingGuard: {
        isCurrent: this.isCurrent,
        subscribe: (notify) => subscribeToConnectionBinding(this.client, this.binding, () => {
          if (!isConnectionBindingCurrent(this.client, this.binding)) this.retired = true;
          notify();
        }),
      },
    });
    config.signal?.addEventListener('abort', this.onAbort, { once: true });
    if (config.signal?.aborted) void this.close();
  }

  public get commands(): Commands<T> { return this.operations; }
  public get recordScope(): object { return this.recordToken; }
  public get signal(): AbortSignal { return this.lifetime.signal; }
  public readonly getSnapshot = () => this.project(this.view.getSnapshot());
  public readonly getServerSnapshot = () => this.project(this.view.getServerSnapshot());
  public readonly subscribe = (notify: () => void): (() => void) => this.view.subscribe(notify);
  public readonly retry = (): Promise<void> => this.view.retry();
  public readonly loadMore = (): Promise<void> => this.view.loadMore();
  public readonly ready = async (options: { signal?: AbortSignal } = {}) => {
    const retry = this.view.getSnapshot().retry;
    const state = await this.view.ready(options);
    if (!this.isCurrent() || this.view.getSnapshot().retry !== retry) throw new EnboxBindingChangedError();
    return this.project(state) as Extract<ReturnType<typeof this.getSnapshot>, { status: 'ready' }>;
  };
  public readonly select = (options: LocalRecordQuery | null): Promise<void> => {
    if (!this.isCurrent()) return Promise.reject(new EnboxBindingChangedError());
    const selection = this.normalize(options);
    const previous = this.view.getSnapshot().selection;
    if (serializeQuery(selection) === serializeQuery(previous)) return this.view.select(previous);
    if (selection?.filter?.recordId !== previous?.filter?.recordId
      || selection?.within !== previous?.within || (selection === null) !== (previous === null)) {
      this.recordToken = {};
    }
    if (selection?.within !== previous?.within || (selection === null) !== (previous === null)) {
      this.operations = this.commandsFor(selection);
    }
    const opening = this.view.select(selection);
    notifyListeners(this.selectionListeners);
    return opening;
  };
  public matches(options: LocalRecordQuery | null): boolean {
    return serializeQuery(this.normalize(options)) === serializeQuery(this.view.getSnapshot().selection);
  }
  public get pageSize(): number { return this.config.pageSize ?? 20; }
  public readonly query = async (options: LocalRecordQuery): Promise<readonly EnboxRecordItem<T>[]> => {
    const query = this.normalize(options)!;
    const { enabled: _queryEnabled, ...request } = query;
    const result = await this.api().query<string, true>(this.path, { ...request, materialize: true, pagination: query.pagination! });
    const rows: EnboxRecordItem<T>[] = [];
    for await (const row of result) {
      if (!this.isCurrent()) throw new EnboxBindingChangedError();
      const materialized = row as TypedMaterializedRecord<T>;
      rows.push(recordItem(materialized.record, materialized.value));
    }
    if (!this.isCurrent()) throw new EnboxBindingChangedError();
    return Object.freeze(rows);
  };
  public readonly close = (): Promise<void> => {
    if (this.closed) return this.view.close();
    this.closed = true;
    this.config.signal?.removeEventListener('abort', this.onAbort);
    this.lifetime.abort();
    const closing = this.view.close();
    notifyListeners(this.selectionListeners);
    this.selectionListeners.clear();
    return closing;
  };
  private readonly onAbort = (): void => { void this.close(); };

  public readonly isCurrent = (): boolean => !this.closed && !this.retired && this.config.signal?.aborted !== true
    && isConnectionBindingCurrent(this.client, this.binding);
  private api() {
    if (!this.isCurrent()) throw new EnboxBindingChangedError();
    if (this.binding.enbox === undefined || this.binding.session === undefined) throw new EnboxNotConnectedError();
    return this.binding.enbox.using(this.protocol).records;
  }
  private normalize(options: LocalRecordQuery | null): LocalRecordQuery | null {
    const copy = copyLocalQuery(options);
    if (copy === null) return null;
    assertParentScope(this.path, copy.within);
    return Object.freeze({ ...copy, pagination: copy.pagination ?? Object.freeze({ limit: this.config.pageSize ?? 20 }) });
  }
  private projectRows(rows: readonly TypedMaterializedRecord<T>[]): readonly EnboxRecordItem<T>[] {
    let projected = this.rows.get(rows);
    if (projected === undefined) {
      projected = Object.freeze(rows.map(({ record, value }) => recordItem(record, value)));
      this.rows.set(rows, projected);
    }
    return projected;
  }
  private project(state: SelectedRecordSnapshot<TypedMaterializedRecord<T>, LocalRecordQuery>) {
    let projected = this.snapshots.get(state);
    if (projected === undefined) {
      projected = Object.freeze({ ...state, records: this.projectRows(state.records) });
      this.snapshots.set(state, projected);
    }
    return projected;
  }
  private commandsFor(selection: LocalRecordQuery | null, key = {}): Commands<T> {
    const token = this.token = {};
    const valid = (): boolean => this.token === token && this.isCurrent();
    const isCurrent = (): boolean => selection !== null && valid();
    const target = (override?: { within?: string }) => {
      if (!valid() || selection === null && override === undefined) throw new EnboxBindingChangedError();
      const within = override !== undefined && Object.hasOwn(override, 'within') ? override.within : selection?.within;
      assertParentScope(this.path, within);
      return { api: this.api(), within };
    };
    const resolve = async (id: string | undefined, api: ReturnType<typeof this.api>, within?: string): Promise<string | undefined> => {
      if (id === undefined) {
        if (!isSingletonPath(this.protocol.definition, this.path)) throw new TypeError('A non-singleton mutation requires a record ID.');
        return (await api.read(this.path, { filter: {}, ...(within === undefined ? {} : { within }) }))?.id;
      }
      if (within !== undefined) {
        const record = await api.read(this.path, id);
        if (record !== undefined && record.contextId.split('/').slice(0, -1).join('/') !== within) {
          throw new TypeError(`Record '${id}' does not belong to the selected parent context.`);
        }
      }
      return id;
    };
    return Object.freeze({
      key, isCurrent, subscribe: this.selectionSource.subscribe,
      create: async (data: T, override?: { within?: string }): Promise<EnboxRecordItem<T>> => {
        const { api, within } = target(override);
        const record = await api.create(this.path, { data, ...(within === undefined ? {} : { parentContextId: within }) }) as TypedRecord<T>;
        return recordItem(record, await record.value());
      },
      patch: async (input: { id?: string; patch: RecordPatchInput<T> }, override?: { within?: string }): Promise<EnboxRecordItem<T>> => {
        const { id: requestedId, patch } = input;
        const { api, within } = target(override);
        const id = await resolve(requestedId, api, within);
        if (id === undefined) throw new DwnResponseError('RecordStore.patch', { code: 404, detail: 'Not Found' });
        const record = await api.patch(this.path, id, patch as RecordPatchInput<unknown>) as TypedRecord<T>;
        return recordItem(record, await record.value());
      },
      delete: async (requestedId?: string, options?: { within?: string; prune?: boolean }): Promise<void> => {
        const prune = options?.prune;
        const { api, within } = target(options);
        const id = await resolve(requestedId, api, within);
        if (id === undefined) return;
        await api.delete(this.path, { recordId: id, ...(within === undefined ? {} : { within }),
          ...(prune === undefined ? {} : { prune }) });
      },
      set: async (data: T, override?: { within?: string }): Promise<EnboxRecordItem<T>> => {
        if (!isSingletonPath(this.protocol.definition, this.path)) throw new TypeError('set requires a protocol-declared singleton.');
        const { api, within } = target(override);
        // The runtime cardinality check supplies the proof erased by the shared path binding.
        const set = api.set as (path: string, request: { data: T; within?: string }) => Promise<TypedRecord<T>>;
        const record = await set.call(api, this.path, { data, ...(within === undefined ? {} : { within }) });
        return recordItem(record, await record.value());
      },
    });
  }
}
