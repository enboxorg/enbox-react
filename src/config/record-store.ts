import type { ConnectionStore, ContextRoleGroups, DataForPath, ProtocolDefinition, TypedProtocol } from '@enbox/browser';
import type { RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';
import type { SelectedRecordStoreConfig, SelectedRecordStore } from '../internal/selected-record-store.js';
import type {
  AnyEnboxRecordStore, DataRecordPath, EnboxRecordOptions, EnboxRecordsOptions,
  EnboxRecordStore, EnboxSingletonOptions, RecordKind,
} from './record-types.js';
import type { SingletonPaths } from '../internal/singleton-paths.js';

import { RecordViewObserver } from '../internal/record-view-observer.js';
import { SelectedRecords } from '../internal/selected-record-store.js';
import { EnboxRecordOwner } from '../internal/enbox-record-store.js';
import { singleRecordKind } from '../internal/record-commands.js';

export type {
  EnboxRecordStore, EnboxRecordsOptions, EnboxRecordOptions, EnboxSingletonOptions,
  EnboxRecordItem, EnboxRecordsSnapshot, EnboxRecordSnapshot, EnboxSingletonSnapshot,
} from './record-types.js';
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

type TypedStoreConfig<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups, Path extends string> =
  RecordStoreOptions & Readonly<{ client: ConnectionStore; protocol: TypedProtocol<D, C, R>; path: Path }>;
type QueryOptions<Path extends string, Options> = Path extends `${string}/${string}`
  ? { options: Options | null } : { options?: Options | null };
type RuntimeStoreConfig = RecordStoreOptions & {
  client: ConnectionStore; protocol: TypedProtocol; path: string; options?: object | null;
};

/** Create an explicit collection owner for controllers and borrowing React hooks. */
export function createRecordsStore<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends DataRecordPath<D>,
>(config: TypedStoreConfig<D, C, R, Path> & QueryOptions<Path, EnboxRecordsOptions<D, NoInfer<Path>>>):
  EnboxRecordStore<DataForPath<C, Path>, EnboxRecordsOptions<D, Path>, 'collection'>;
export function createRecordsStore(config: RuntimeStoreConfig): AnyEnboxRecordStore {
  return createTypedStore(config, 'collection');
}

/** Observe a protocol-declared singleton without supplying a record ID. */
export function createRecordStore<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends SingletonPaths<D> & DataRecordPath<D>,
>(config: TypedStoreConfig<D, C, R, Path> & QueryOptions<Path, EnboxSingletonOptions<NoInfer<Path>>>):
  EnboxRecordStore<DataForPath<C, Path>, EnboxSingletonOptions<Path>, 'singleton'>;
/** Observe one ordinary record by ID. */
export function createRecordStore<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends DataRecordPath<D>,
>(config: TypedStoreConfig<D, C, R, Path> & { options: EnboxRecordOptions<NoInfer<Path>> | null }):
  EnboxRecordStore<DataForPath<C, Path>, EnboxRecordOptions<Path>, 'record'>;
/** Subscription, ready(), or retry() opens an arbitrary native view until close() or abort. */
export function createRecordStore<Item>(
  opener: RecordViewOpener<Item> | null,
  options?: RecordStoreOptions,
): RecordStore<Item>;
/** Create a native view store with a changeable selection. */
export function createRecordStore<Item, Selection>(
  config: SelectedRecordStoreConfig<Item, Selection>,
): SelectedRecordStore<Item, Selection>;
export function createRecordStore<Item, Selection>(
  opener: RecordViewOpener<Item> | null | SelectedRecordStoreConfig<Item, Selection> | RuntimeStoreConfig,
  options: RecordStoreOptions = {},
): RecordStore<Item> | SelectedRecordStore<Item, Selection> | AnyEnboxRecordStore {
  if (opener !== null && typeof opener === 'object') {
    if ('protocol' in opener) return createTypedStore(opener, singleRecordKind(opener.protocol, opener.path, opener.options));
    return new SelectedRecords(opener);
  }
  return new RecordViewObserver(opener, {
    ownerSignal: options.signal,
    retainWithoutSubscribers: true,
    loadAll: options.loadAll === true,
  });
}

function createTypedStore(config: RuntimeStoreConfig, kind: RecordKind): AnyEnboxRecordStore {
  return new EnboxRecordOwner({ protocol: config.protocol, path: config.path, kind }, {
    client: config.client, selection: config.options === undefined ? {} : config.options,
    ...(config.signal === undefined ? {} : { signal: config.signal }),
    ...(config.loadAll === undefined ? {} : { loadAll: config.loadAll }),
  });
}

export function isRecordStore<Item>(value: unknown): value is RecordStore<Item> {
  return value !== null && typeof value === 'object'
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'getServerSnapshot' in value && typeof value.getServerSnapshot === 'function';
}
