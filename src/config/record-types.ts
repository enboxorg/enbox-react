import type {
  ConnectionStore, ProtocolDefinition, ProtocolPaths,
  ProtocolRolePaths, RecordPatchInput, RecordQuery, TypedDeleteRequest, TypedRecord,
} from '@enbox/browser';
import type { RecordViewResult } from '../internal/record-view-observer.js';

export type RecordKind = 'collection' | 'record' | 'singleton';
export type DataRecordPath<D extends ProtocolDefinition> = Exclude<ProtocolPaths<D>, ProtocolRolePaths<D>> & string;
type RecordScope<Path extends string> = Path extends `${string}/${string}` ? { within: string } : { within?: never };

export type EnboxRecordsOptions<D extends ProtocolDefinition, Path extends ProtocolPaths<D> & string> =
  Omit<RecordQuery<D, Path>, 'within' | 'pagination' | 'from' | 'protocolRole'> & RecordScope<Path> & {
    enabled?: boolean; pagination?: { limit: number }; from?: never; protocolRole?: never;
  };
export type EnboxRecordOptions<Path extends string> = RecordScope<Path> & {
  recordId: string; enabled?: boolean; from?: never; protocolRole?: never;
};
export type EnboxSingletonOptions<Path extends string> = Omit<EnboxRecordOptions<Path>, 'recordId'> & { recordId?: never };

export type EnboxRecordItem<T> = Readonly<{
  id: string; contextId: string; data: Readonly<T>; record: TypedRecord<T>;
}>;
export type CommandScope = Readonly<{ scope: object; isCurrent(): boolean }>;
export type RecordDeleteOptions = Pick<TypedDeleteRequest, 'prune'>;
export type EnboxRecordsCommands<T> = CommandScope & Readonly<{
  create(data: T): Promise<TypedRecord<T>>;
  patch(variables: { id: string; patch: RecordPatchInput<T> }): Promise<TypedRecord<T>>;
  delete(id: string, options?: RecordDeleteOptions): Promise<void>;
}>;
export type EnboxRecordCommands<T> = CommandScope & Readonly<{
  patch(value: RecordPatchInput<T>): Promise<TypedRecord<T>>;
  delete(options?: RecordDeleteOptions): Promise<void>;
}>;
export type EnboxSingletonCommands<T> = EnboxRecordCommands<T> & Readonly<{ set(data: T): Promise<TypedRecord<T>> }>;

type CollectionState<T> = RecordViewResult<EnboxRecordItem<T>> & Readonly<{
  isReady: boolean; isLoading: boolean; loadMore(): Promise<void>;
}>;
type SingleState<State, T> = State extends unknown ? Omit<State, 'records' | 'hasMore' | 'isLoadingMore'> & Readonly<{
  data: Readonly<T> | undefined; record: TypedRecord<T> | undefined;
  isReady: boolean; isLoading: boolean; isMissing: boolean;
}> : never;
export type EnboxRecordsSnapshot<T, Selection> = CollectionState<T> & Readonly<{
  selection: Readonly<Selection> | null; commands: EnboxRecordsCommands<T>;
}>;
export type EnboxRecordSnapshot<T, Selection> = SingleState<RecordViewResult<EnboxRecordItem<T>>, T> & Readonly<{
  selection: Readonly<Selection> | null; commands: EnboxRecordCommands<T>;
}>;
export type EnboxSingletonSnapshot<T, Selection> = SingleState<RecordViewResult<EnboxRecordItem<T>>, T> & Readonly<{
  selection: Readonly<Selection> | null; commands: EnboxSingletonCommands<T>;
}>;

export type RecordSnapshotFor<T, Selection, Kind extends RecordKind> = Kind extends 'collection'
  ? EnboxRecordsSnapshot<T, Selection> : Kind extends 'singleton'
    ? EnboxSingletonSnapshot<T, Selection> : EnboxRecordSnapshot<T, Selection>;

/** One session-bound read/write owner, usable by controllers and React bindings. */
export type EnboxRecordStore<T, Selection, Kind extends RecordKind = RecordKind> = Readonly<{
  client: ConnectionStore;
  kind: Kind;
  commands: RecordSnapshotFor<T, Selection, Kind>['commands'];
  getSnapshot(): RecordSnapshotFor<T, Selection, Kind>;
  getServerSnapshot(): RecordSnapshotFor<T, Selection, Kind>;
  subscribe(notify: () => void): () => void;
  ready(options?: { signal?: AbortSignal }): Promise<Extract<RecordSnapshotFor<T, Selection, Kind>, { status: 'ready' }>>;
  select(selection: Selection | null): Promise<void>;
  retry(): Promise<void>;
  close(): Promise<void>;
}> & (Kind extends 'collection' ? Readonly<{
  loadMore(): Promise<void>;
  /** Display-only rows; the next native publication replaces them. */
  updateRecords(update: (records: readonly EnboxRecordItem<T>[]) => readonly EnboxRecordItem<T>[]): void;
}> : {});
export type AnyEnboxRecordStore = EnboxRecordStore<unknown, unknown>;
