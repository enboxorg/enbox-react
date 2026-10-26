'use client';

import type {
  ContextRoleGroups, DataForPath, Enbox, ProtocolDefinition, ProtocolPaths, ProtocolRolePaths,
  RecordPatchInput, RecordQuery, TypedCreateRequest, TypedMaterializedRecord, TypedProtocol, TypedRecord, TypedSetRequest,
} from '@enbox/browser';
import type { EnboxMutationResult } from './mutation.js';
import type { RecordsOptions, RecordsResult } from './records.js';
import type { SingletonPaths } from '../internal/singleton-paths.js';

import { DwnResponseError } from '@enbox/browser';
import { useCallback, useMemo } from 'react';

import { EnboxBindingChangedError } from '../errors.js';
import { serializeQuery } from '../internal/serialize-query.js';
import { isSingletonPath } from '../internal/singleton-paths.js';
import { useEnboxMutation } from './mutation.js';
import { useRecords } from './records.js';

type DataRecordPath<Definition extends ProtocolDefinition> = Exclude<ProtocolPaths<Definition>, ProtocolRolePaths<Definition>> & string;
type RecordScope<Path extends string> = Path extends `${string}/${string}` ? { within: string } : { within?: never };
type RecordScopeArguments<Path extends string, Options> = Path extends `${string}/${string}`
  ? [options: Options | null] : [options?: Options | null];

/** Local, session-owned selection. Remote and role-authorized reads use useRecords. */
export type EnboxRecordsOptions<Definition extends ProtocolDefinition, Path extends ProtocolPaths<Definition> & string> =
  Omit<RecordQuery<Definition, Path>, 'within' | 'pagination' | 'from' | 'protocolRole'> & RecordScope<Path> & {
    enabled?: boolean;
    pagination?: { limit: number };
    from?: never;
    protocolRole?: never;
  };
export type EnboxRecordOptions<Path extends string> = RecordScope<Path> & {
  recordId: string; enabled?: boolean; from?: never; protocolRole?: never;
};
export type EnboxSingletonOptions<Path extends string> = Omit<EnboxRecordOptions<Path>, 'recordId'> & { recordId?: never };

export type EnboxRecordItem<T> = Readonly<{
  id: string;
  contextId: string;
  data: Readonly<T>;
  record: TypedRecord<T>;
}>;
type CollectionQueryResult<State, T> = State extends unknown
  ? Omit<State, 'records'> & Readonly<{ records: readonly EnboxRecordItem<T>[]; isReady: boolean; isLoading: boolean }>
  : never;
export type EnboxRecordsResult<T> = CollectionQueryResult<RecordsResult<TypedMaterializedRecord<T>>, T> & Readonly<{
  create: EnboxMutationResult<T, TypedRecord<T>>;
  patch: EnboxMutationResult<{ id: string; patch: RecordPatchInput<T> }, TypedRecord<T>> & { isPendingFor(id: string): boolean };
  delete: EnboxMutationResult<string, void> & { isPendingFor(id: string): boolean };
}>;
type SingleRecordQueryResult<State, T> = State extends unknown
  ? Omit<State, 'records' | 'hasMore' | 'loadMore' | 'isLoadingMore'> & Readonly<{
    data: Readonly<T> | undefined;
    record: TypedRecord<T> | undefined;
    isReady: boolean;
    isLoading: boolean;
    isMissing: boolean;
  }> : never;
export type EnboxRecordResult<T> = SingleRecordQueryResult<RecordsResult<TypedMaterializedRecord<T>>, T> & Readonly<{
  patch: EnboxMutationResult<RecordPatchInput<T>, TypedRecord<T>>;
  delete: EnboxMutationResult<void, void>;
}>;
export type EnboxSingletonResult<T> = EnboxRecordResult<T> & Readonly<{
  set: EnboxMutationResult<T, TypedRecord<T>>;
}>;

function copyLocalOptions<Options extends object | null | undefined>(options: Options): Options {
  if (options == null) return options;
  if (Object.hasOwn(options, 'from') || Object.hasOwn(options, 'protocolRole')) {
    throw new TypeError('Enbox record mutations require the local session. Use useRecords for remote or role-authorized reads.');
  }
  return JSON.parse(serializeQuery(options)) as Options;
}

function assertScope(path: string, within: string | undefined, active: boolean): void {
  if (!active) throw new EnboxBindingChangedError();
  const parentDepth = path.split('/').length - 1;
  if (parentDepth === 0 ? within !== undefined
    : typeof within !== 'string' || within.trim() === '' || within.split('/').length !== parentDepth) {
    throw new TypeError('Nested record selections require their direct parent context; root records do not accept within.');
  }
}

function useHandledControl(control: () => Promise<void>): () => Promise<void> {
  return useCallback(() => {
    const result = control();
    // Query failures are already published in state; awaited calls still reject.
    void result.catch(() => {});
    return result;
  }, [control]);
}

/** Native patch is path-bound; also fence IDs to this hook's immutable parent scope. */
async function assertParent(
  read: () => Promise<{ readonly contextId: string } | undefined>, within: string | undefined,
): Promise<void> {
  if (within === undefined) return;
  const record = await read();
  // Let native patch/delete retain their missing-record and idempotent-delete contracts.
  if (record === undefined) return;
  if (record.contextId.split('/').slice(0, -1).join('/') !== within) {
    throw new TypeError('The record does not belong to the selected parent context.');
  }
}

function useLocalRecordQuery<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  Path extends ProtocolPaths<Definition> & string,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options: (RecordQuery<Definition, Path> & { enabled?: boolean }) | null | undefined,
): RecordsResult<TypedMaterializedRecord<DataForPath<Codecs, Path>>> {
  return useRecords<Definition, Codecs, RoleGroups, Path, true>(protocol, path, options === null ? null : {
    ...options, pagination: options?.pagination ?? { limit: 20 }, materialize: true,
  } as RecordsOptions<Definition, Path, true> & { materialize: true });
}

/** Materialized local collection with native, context-scoped CRUD commands. */
export function useEnboxRecords<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends DataRecordPath<Definition>,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  ...args: RecordScopeArguments<Path, EnboxRecordsOptions<Definition, NoInfer<Path>>>
): EnboxRecordsResult<DataForPath<Codecs, Path>> {
  type Value = DataForPath<Codecs, Path>;
  const options = copyLocalOptions(args[0]);
  const within = options?.within;
  const active = options !== null;
  if (active) assertScope(path, within, active);
  const scope = useMemo(() => ({ protocol, path, within, active }), [protocol, path, within, active]);
  const query = useLocalRecordQuery(protocol, path, options);
  const retry = useHandledControl(query.retry);
  const loadMore = useHandledControl(query.loadMore);
  const create = useEnboxMutation(useCallback(async (enbox, data: Value) => {
    assertScope(path, within, active);
    // Role paths are excluded: ordinary data creates need only data and the selected parent.
    return enbox.using(protocol).records.create(path, {
      data, ...(within === undefined ? {} : { parentContextId: within }),
    } as TypedCreateRequest<Definition, Codecs, Path>);
  }, [protocol, path, within, active]), { scope });
  const patch = useEnboxMutation(useCallback(async (enbox, variables: { id: string; patch: RecordPatchInput<Value> }) => {
    assertScope(path, within, active);
    const { id, patch: value } = variables;
    const api = enbox.using(protocol);
    await assertParent(() => api.records.read(path, id), within);
    return api.records.patch(path, id, value);
  }, [protocol, path, within, active]), { scope });
  const remove = useEnboxMutation(useCallback(async (enbox, id: string) => {
    assertScope(path, within, active);
    const api = enbox.using(protocol);
    await assertParent(() => api.records.read(path, id), within);
    await api.records.delete(path, { recordId: id, ...(within === undefined ? {} : { within }) });
  }, [protocol, path, within, active]), { scope });
  const records = useMemo(() => Object.freeze(query.records.map((row) => Object.freeze({
    id: row.record.id, contextId: row.record.contextId, data: row.value, record: row.record,
  }))), [query.records]);
  const patchControl = useMemo(() => Object.freeze({
    ...patch, isPendingFor: (id: string): boolean => patch.pendingVariables.some((value) => value.id === id),
  }), [patch]);
  const deleteControl = useMemo(() => Object.freeze({
    ...remove, isPendingFor: (id: string): boolean => remove.pendingVariables.includes(id),
  }), [remove]);
  return useMemo(() => Object.freeze({
    ...query, records, retry, loadMore, isReady: query.status === 'ready', isLoading: query.status === 'loading',
    create, patch: patchControl, delete: deleteControl,
  }), [query, records, retry, loadMore, create, patchControl, deleteControl]);
}

/** Observe a schema-declared singleton by path; nested paths require their direct parent. */
export function useEnboxRecord<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends SingletonPaths<Definition> & DataRecordPath<Definition>,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  ...args: RecordScopeArguments<Path, EnboxSingletonOptions<NoInfer<Path>>>
): EnboxSingletonResult<DataForPath<Codecs, Path>>;
/** Observe and mutate one local record by its explicit ID. Null disables selection. */
export function useEnboxRecord<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends DataRecordPath<Definition>,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options: EnboxRecordOptions<Path> | null,
): EnboxRecordResult<DataForPath<Codecs, Path>>;
export function useEnboxRecord<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends DataRecordPath<Definition>,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options?: (RecordScope<Path> & { recordId?: string; enabled?: boolean }) | null,
): EnboxRecordResult<DataForPath<Codecs, Path>> | EnboxSingletonResult<DataForPath<Codecs, Path>> {
  type Value = DataForPath<Codecs, Path>;
  const hasRecordId = options != null && Object.hasOwn(options, 'recordId');
  const copied = copyLocalOptions(options);
  const within = copied?.within;
  const recordId = copied?.recordId;
  const active = copied !== null;
  const singleton = useMemo(() => isSingletonPath(protocol.definition, path), [protocol, path]);
  const selection = useMemo(() => {
    if (!active) return null;
    assertScope(path, within, true);
    if (hasRecordId && (typeof recordId !== 'string' || recordId.trim() === '')) {
      throw new TypeError('useEnboxRecord requires a nonempty recordId.');
    }
    if (!hasRecordId && !singleton) {
      throw new TypeError('useEnboxRecord requires a recordId unless the path declares $recordLimit.max: 1.');
    }
    return { protocol, path, within, recordId };
  }, [protocol, path, within, recordId, active, hasRecordId, singleton]);
  const query = useLocalRecordQuery(protocol, path, copied === null ? null : {
    ...copied, filter: recordId === undefined ? {} : { recordId }, pagination: { limit: 1 },
  });
  const retry = useHandledControl(query.retry);
  const row = query.records[0];
  const resolveTarget = useCallback(async (enbox: Enbox) => {
    if (selection === null) throw new EnboxBindingChangedError();
    const api = enbox.using(selection.protocol);
    const id = selection.recordId;
    if (id !== undefined) {
      await assertParent(() => api.records.read(selection.path, id), selection.within);
      return { api, id };
    }
    // Resolve the native singleton slot even when observation is paused or stale.
    const record = await api.records.read(selection.path, {
      filter: {}, ...(selection.within === undefined ? {} : { within: selection.within }),
    });
    return { api, id: record?.id };
  }, [selection]);
  const patch = useEnboxMutation(useCallback(async (enbox, value: RecordPatchInput<Value>) => {
    const { api, id } = await resolveTarget(enbox);
    if (id === undefined) throw new DwnResponseError('useEnboxRecord.patch', { code: 404, detail: 'Not Found' });
    return api.records.patch(path, id, value);
  }, [resolveTarget, path]), { scope: selection });
  const remove = useEnboxMutation(useCallback(async (enbox, _variables: void) => {
    const { api, id } = await resolveTarget(enbox);
    if (id !== undefined) {
      await api.records.delete(path, { recordId: id, ...(within === undefined ? {} : { within }) });
    }
  }, [resolveTarget, path, within]), { scope: selection });
  const set = useEnboxMutation(useCallback(async (enbox, data: Value) => {
    if (selection === null) throw new EnboxBindingChangedError();
    return enbox.using(selection.protocol).records.set(selection.path as SingletonPaths<Definition>, {
      data, ...(selection.within === undefined ? {} : { within: selection.within }),
    } as TypedSetRequest<Codecs, SingletonPaths<Definition>>);
  }, [selection]), { scope: selection });
  return useMemo(() => {
    const { records: _rows, loadMore: _load, hasMore: _more, isLoadingMore: _loading, ...state } = query;
    return Object.freeze({
      ...state, retry, data: row?.value, record: row?.record,
      isReady: query.status === 'ready', isLoading: query.status === 'loading',
      isMissing: query.status === 'ready' && row === undefined,
      patch, delete: remove, ...(singleton && !hasRecordId ? { set } : {}),
    });
  }, [query, row, retry, patch, remove, set, singleton, hasRecordId]);
}
