import type { ConnectionStore, ContextRoleGroups, DataForPath, ProtocolDefinition, TypedProtocol } from '@enbox/browser';
import type { DataRecordPath, EnboxRecordsOptions, EnboxRecordStore } from './record-types.js';
import type { SingletonPaths } from '../internal/singleton-paths.js';
import type { BoundRecordOptions } from '../internal/bound-record-store.js';
import type { RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';
import { BoundRecordStore } from '../internal/bound-record-store.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';
import type { SelectedRecordStoreConfig, SelectedRecordStore } from '../internal/selected-record-store.js';
import { SelectedRecords } from '../internal/selected-record-store.js';

export type { SelectedRecordStoreConfig, SelectedRecordStore, SelectedRecordSnapshot } from '../internal/selected-record-store.js';
export type { EnboxRecordItem, EnboxRecordStore } from './record-types.js';

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

type BoundRecordConfig<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups, Path extends DataRecordPath<D>> =
  RecordStoreOptions & { client: ConnectionStore; protocol: TypedProtocol<D, C, R>; path: Path; pageSize?: number }
  & (Path extends `${string}/${string}` ? { options: EnboxRecordsOptions<D, NoInfer<Path>> | null }
    : { options?: EnboxRecordsOptions<D, NoInfer<Path>> | null });

/** A typed query owner; singleton commands follow the protocol's cardinality. */
export function createRecordStore<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends SingletonPaths<D> & DataRecordPath<D>,
>(config: BoundRecordConfig<D, C, R, Path>): EnboxRecordStore<DataForPath<C, Path>, EnboxRecordsOptions<D, Path>, Path, true>;
export function createRecordStore<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends DataRecordPath<D>,
>(config: BoundRecordConfig<D, C, R, Path>): EnboxRecordStore<DataForPath<C, Path>, EnboxRecordsOptions<D, Path>, Path>;
/** Subscription, ready(), or retry() opens the view until close() or abort. */
export function createRecordStore<Item>(
  opener: RecordViewOpener<Item> | null,
  options?: RecordStoreOptions,
): RecordStore<Item>;
/** Create a store with a changeable selection; select() and retry() can also open its view. */
export function createRecordStore<Item, Selection>(
  config: SelectedRecordStoreConfig<Item, Selection>,
): SelectedRecordStore<Item, Selection>;
export function createRecordStore<Item, Selection>(
  opener: unknown,
  options: RecordStoreOptions = {},
): unknown {
  if (opener !== null && typeof opener === 'object') {
    if ('protocol' in opener) {
      const config = opener as Omit<BoundRecordOptions, 'options'> & { options?: BoundRecordOptions['options'] };
      return new BoundRecordStore({
        client: config.client, protocol: config.protocol, path: config.path,
        options: config.options === undefined ? {} : config.options,
        ...(config.signal === undefined ? {} : { signal: config.signal }),
        ...(config.loadAll === undefined ? {} : { loadAll: config.loadAll }),
        ...(config.pageSize === undefined ? {} : { pageSize: config.pageSize }),
      });
    }
    return new SelectedRecords(opener as SelectedRecordStoreConfig<Item, Selection>);
  }
  return new RecordViewObserver(opener as RecordViewOpener<Item> | null, {
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
