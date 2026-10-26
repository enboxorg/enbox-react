import type {
  ConnectionStore, ProtocolDefinition, ProtocolPaths,
  ProtocolRolePaths, RecordPatchInput, RecordQuery, TypedProtocol, TypedRecord,
} from '@enbox/browser';
import type { SelectedRecordStore } from '../internal/selected-record-store.js';
import type { EnboxMutationScope } from '../internal/mutation-observer.js';

export type DataRecordPath<D extends ProtocolDefinition> = Exclude<ProtocolPaths<D>, ProtocolRolePaths<D>> & string;
type ParentScope<Path extends string> = Path extends `${string}/${string}` ? { within: string } : { within?: never };
export type EnboxRecordsOptions<D extends ProtocolDefinition, Path extends ProtocolPaths<D> & string> =
  Omit<RecordQuery<D, Path>, 'within' | 'pagination' | 'from' | 'protocolRole'> & ParentScope<Path> & {
    pagination?: { limit: number }; enabled?: boolean; from?: never; protocolRole?: never;
  };
export type EnboxRecordOptions<Path extends string> = ParentScope<Path> & {
  recordId: string; enabled?: boolean; from?: never; protocolRole?: never;
};
export type EnboxSingletonOptions<Path extends string> = Omit<EnboxRecordOptions<Path>, 'recordId'> & { recordId?: never };

/** The same decoded row in React, controllers, and successful mutations. */
export type EnboxRecordItem<T> = Readonly<{
  id: string; contextId: string; dateCreated: string; timestamp: string;
  data: Readonly<T>; record: TypedRecord<T>;
}>;
export type RecordWriteScope<Path extends string> = Path extends `${string}/${string}` ? { within?: string } : { within?: never };
export type RecordCommands<T, Path extends string, Singleton extends boolean = false> = EnboxMutationScope & Readonly<{
  create(data: T, scope?: RecordWriteScope<Path>): Promise<EnboxRecordItem<T>>;
  patch(input: { patch: RecordPatchInput<T> } & (Singleton extends true ? { id?: string } : { id: string }),
    scope?: RecordWriteScope<Path>): Promise<EnboxRecordItem<T>>;
  delete(...args: Singleton extends true ? [id?: string, options?: RecordWriteScope<Path> & { prune?: boolean }]
    : [id: string, options?: RecordWriteScope<Path> & { prune?: boolean }]): Promise<void>;
}>;

/** One query owner shared by imperative consumers and React bindings. */
export type EnboxRecordStore<T, Selection, Path extends string = string, Singleton extends boolean = false> =
  Omit<SelectedRecordStore<EnboxRecordItem<T>, Selection>, 'updateRecords'> & Readonly<{
    client: ConnectionStore;
    protocol: TypedProtocol;
    path: Path;
    commands: RecordCommands<T, Path, Singleton> & (Singleton extends true ? Readonly<{
      set(data: T, scope?: RecordWriteScope<Path>): Promise<EnboxRecordItem<T>>;
    }> : {});
    /** Read all matching rows from the native SDK, independently of the loaded view. */
    query(options: Selection): Promise<readonly EnboxRecordItem<T>[]>;
  }>;
