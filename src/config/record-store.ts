import type { RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';
import type { SelectedRecordStoreConfig, SelectedRecordStore } from '../internal/selected-record-store.js';
import { SelectedRecords } from '../internal/selected-record-store.js';
import type { AnyEnboxRecordStore, AnyRecordDefinition, RecordSelectionFor, RecordStoreFor } from './record-definition.js';
import type { EnboxRecordStoreOptions } from '../internal/enbox-record-store.js';
import { isRecordDefinition } from './record-definition.js';
import { EnboxRecordOwner } from '../internal/enbox-record-store.js';

export { defineRecordStore } from './record-definition.js';
export type {
  EnboxRecordStore, RecordDefinition, RecordStoreFor, RecordSelectionFor,
  EnboxRecordsOptions, EnboxRecordOptions, EnboxSingletonOptions,
  EnboxRecordItem, EnboxRecordsSnapshot, EnboxRecordSnapshot, EnboxSingletonSnapshot,
} from './record-definition.js';
export type { EnboxRecordStoreOptions } from '../internal/enbox-record-store.js';

export type { SelectedRecordStoreConfig, SelectedRecordStore, SelectedRecordSnapshot } from '../internal/selected-record-store.js';

/** One owned view shared by React consumers and application controllers. */
export type RecordStore<Item> = Readonly<{
  getSnapshot(): RecordViewResult<Item>;
  getServerSnapshot(): RecordViewResult<Item>;
  subscribe(notify: () => void): () => void;
  /** Wait for usable local rows without waiting for replication currentness. */
  ready(options?: { signal?: AbortSignal }): Promise<Extract<RecordViewResult<Item>, { status: 'ready' }>>;
  /** Start or reopen the view; resolves after attachment rather than row readiness. */
  retry(): Promise<void>;
  /** Expand the retained prefix; concurrent calls share the same Promise. */
  loadMore(): Promise<void>;
  /** Close permanently and wait for views already acquired to finish closing. */
  close(): Promise<void>;
}>;

export type RecordStoreOptions = {
  /** Owner lifetime; abort releases the view and invalidates retained controls. */
  signal?: AbortSignal;
  /** Expand the retained selection until the native view has no further page. */
  loadAll?: boolean;
};

/** Subscription, ready(), or retry() opens the view until close() or abort. */
export function createRecordStore<Definition extends AnyRecordDefinition>(
  definition: Definition,
  options: EnboxRecordStoreOptions<RecordSelectionFor<Definition>>,
): RecordStoreFor<Definition>;
export function createRecordStore<Item>(
  opener: RecordViewOpener<Item> | null,
  options?: RecordStoreOptions,
): RecordStore<Item>;
/** Create a store with a changeable selection; select() and retry() can also open its view. */
export function createRecordStore<Item, Selection>(
  config: SelectedRecordStoreConfig<Item, Selection>,
): SelectedRecordStore<Item, Selection>;
export function createRecordStore<Item, Selection>(
  opener: RecordViewOpener<Item> | null | SelectedRecordStoreConfig<Item, Selection> | AnyRecordDefinition,
  options: RecordStoreOptions | EnboxRecordStoreOptions = {},
): RecordStore<Item> | SelectedRecordStore<Item, Selection> | AnyEnboxRecordStore {
  if (isRecordDefinition(opener)) {
    if (!('client' in options)) throw new TypeError('Typed record stores require a connection client.');
    return new EnboxRecordOwner(opener, {
      client: options.client,
      ...(Object.hasOwn(options, 'selection') ? { selection: options.selection } : {}),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.loadAll === undefined ? {} : { loadAll: options.loadAll }),
    });
  }
  if (opener !== null && typeof opener === 'object') return new SelectedRecords(opener);
  return new RecordViewObserver(opener, {
    ownerSignal: options.signal,
    retainWithoutSubscribers: true,
    loadAll: options.loadAll === true,
  });
}

export function isRecordStore<Item>(value: unknown): value is RecordStore<Item> {
  return value !== null && typeof value === 'object'
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'getServerSnapshot' in value && typeof value.getServerSnapshot === 'function';
}
