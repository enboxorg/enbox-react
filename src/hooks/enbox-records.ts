'use client';

import type {
  ContextRoleGroups, DataForPath, ProtocolDefinition, ProtocolPaths, ProtocolRolePaths,
  RecordPatchInput, TypedCreateRequest, TypedEnbox, TypedMaterializedRecord, TypedProtocol,
  TypedRecord, TypedSetRequest,
} from '@enbox/browser';
import type { EnboxMutationResult } from './mutation.js';
import type { RecordsOptions, RecordsResult } from './records.js';

import { useCallback, useMemo } from 'react';

import { EnboxBindingChangedError } from '../errors.js';
import { serializeQuery } from '../internal/serialize-query.js';
import { useEnboxMutation } from './mutation.js';
import { useRecords } from './records.js';

type DataPath<D extends ProtocolDefinition> = Exclude<ProtocolPaths<D>, ProtocolRolePaths<D>> & string;
type SingletonPath<D extends ProtocolDefinition> = Parameters<TypedEnbox<D>['records']['set']>[0] & string;
type Scope<P extends string> = P extends `${string}/${string}` ? { within: string } : { within?: never };
type ScopeArguments<P extends string, Options> = P extends `${string}/${string}`
  ? [options: Options | null] : [options?: Options | null];

/** Local, session-owned selection. Remote and role-authorized reads use useRecords. */
export type EnboxRecordsOptions<D extends ProtocolDefinition, P extends ProtocolPaths<D> & string> =
  Omit<RecordsOptions<D, P>, 'within' | 'pagination' | 'materialize' | 'from' | 'protocolRole'> & Scope<P> & {
    pagination?: { limit: number };
    from?: never;
    protocolRole?: never;
  };
export type EnboxRecordOptions<P extends string> = Scope<P> & { enabled?: boolean; from?: never; protocolRole?: never };

export type EnboxRecordItem<T> = Readonly<{
  id: string;
  contextId: string;
  data: Readonly<T>;
  record: TypedRecord<T>;
}>;
type QueryResult<State, T> = State extends unknown
  ? Omit<State, 'records'> & Readonly<{ records: readonly EnboxRecordItem<T>[]; isReady: boolean; isLoading: boolean }>
  : never;
export type EnboxRecordsResult<T> = QueryResult<RecordsResult<TypedMaterializedRecord<T>>, T> & Readonly<{
  create: EnboxMutationResult<T, TypedRecord<T>>;
  patch: EnboxMutationResult<{ id: string; patch: RecordPatchInput<T> }, TypedRecord<T>> & { isPendingFor(id: string): boolean };
  delete: EnboxMutationResult<string, void> & { isPendingFor(id: string): boolean };
}>;
type SingleQuery<State, T> = State extends unknown
  ? Omit<State, 'records' | 'hasMore' | 'loadMore' | 'isLoadingMore'> & Readonly<{
    data: Readonly<T> | undefined;
    record: TypedRecord<T> | undefined;
    isReady: boolean;
    isLoading: boolean;
  }> : never;
export type EnboxRecordResult<T> = SingleQuery<RecordsResult<TypedMaterializedRecord<T>>, T> & Readonly<{
  patch: EnboxMutationResult<RecordPatchInput<T>, TypedRecord<T>>;
  delete: EnboxMutationResult<void, void>;
}>;
export type EnboxSingletonResult<T> = EnboxRecordResult<T> & Readonly<{
  set: EnboxMutationResult<T, TypedRecord<T>>;
}>;

function copyOptions<Options extends object>(options: Options | null | undefined): Options | null | undefined {
  if (options == null) return options;
  if (Object.hasOwn(options, 'from') || Object.hasOwn(options, 'protocolRole')) {
    throw new TypeError('Enbox record mutations require the local session. Use useRecords for remote or role-authorized reads.');
  }
  return JSON.parse(serializeQuery(options)) as Options;
}

function assertScope(path: string, within: string | undefined, active: boolean): void {
  if (!active) throw new EnboxBindingChangedError();
  if (path.includes('/') ? within === undefined || within.trim() === '' : within !== undefined) {
    throw new TypeError('Nested record mutations require their direct parent context; root records do not accept within.');
  }
}

function useHandledControl(retry: () => Promise<void>): () => Promise<void> {
  return useCallback(() => {
    const result = retry();
    // Query failures are already published in state; awaited calls still reject.
    void result.catch(() => {});
    return result;
  }, [retry]);
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

function useQuery<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], G extends ContextRoleGroups,
  P extends ProtocolPaths<D> & string>(
  protocol: TypedProtocol<D, C, G>, path: P, options: EnboxRecordsOptions<D, P> | null | undefined,
): RecordsResult<TypedMaterializedRecord<DataForPath<C, P>>> {
  return useRecords<D, C, G, P, true>(protocol, path, options === null ? null : {
    ...options, pagination: options?.pagination ?? { limit: 20 }, materialize: true,
  } as RecordsOptions<D, P, true> & { materialize: true });
}

/** Materialized local collection with native, context-scoped CRUD commands. */
export function useEnboxRecords<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], G extends ContextRoleGroups,
  const P extends DataPath<D>>(
  protocol: TypedProtocol<D, C, G>, path: P, ...args: ScopeArguments<P, EnboxRecordsOptions<D, P>>
): EnboxRecordsResult<DataForPath<C, P>> {
  type Value = DataForPath<C, P>;
  const options = copyOptions(args[0]);
  const within = options?.within;
  const active = options !== null;
  const scope = useMemo(() => ({ protocol, path, within, active }), [protocol, path, within, active]);
  const query = useQuery(protocol, path, options);
  const retry = useHandledControl(query.retry);
  const loadMore = useHandledControl(query.loadMore);
  const create = useEnboxMutation(useCallback(async (enbox, data: Value) => {
    assertScope(path, within, active);
    // Role paths are excluded: ordinary data creates need only data and the selected parent.
    return enbox.using(protocol).records.create(path, {
      data, ...(within === undefined ? {} : { parentContextId: within }),
    } as TypedCreateRequest<D, C, P>);
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

/** A schema-declared singleton; set() selects or creates its native occupant. */
export function useEnboxRecord<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], G extends ContextRoleGroups,
  const P extends SingletonPath<D> & DataPath<D>>(
  protocol: TypedProtocol<D, C, G>, path: P, ...args: ScopeArguments<P, EnboxRecordOptions<P> & { recordId?: never }>
): EnboxSingletonResult<DataForPath<C, P>>;
/** One existing local record selected by ID. */
export function useEnboxRecord<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], G extends ContextRoleGroups,
  const P extends DataPath<D>>(
  protocol: TypedProtocol<D, C, G>, path: P, options: (EnboxRecordOptions<P> & { recordId: string }) | null,
): EnboxRecordResult<DataForPath<C, P>>;
export function useEnboxRecord<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], G extends ContextRoleGroups,
  const P extends DataPath<D>>(
  protocol: TypedProtocol<D, C, G>, path: P, options?: (EnboxRecordOptions<P> & { recordId?: string }) | null,
): EnboxRecordResult<DataForPath<C, P>> | EnboxSingletonResult<DataForPath<C, P>> {
  type Value = DataForPath<C, P>;
  const copied = copyOptions(options);
  const within = copied?.within;
  const active = copied !== null;
  const requestedId = copied?.recordId;
  const queryOptions = copied === null ? null : {
    ...(within === undefined ? {} : { within }), ...(copied?.enabled === undefined ? {} : { enabled: copied.enabled }),
    ...(requestedId === undefined ? {} : { filter: { recordId: requestedId } }), pagination: { limit: 1 },
  } as EnboxRecordsOptions<D, P>;
  const query = useQuery(protocol, path, queryOptions);
  const retry = useHandledControl(query.retry);
  const row = query.records[0];
  const id = requestedId ?? row?.record.id;
  const scope = useMemo(() => ({ protocol, path, within, id, active }), [protocol, path, within, id, active]);
  const patch = useEnboxMutation(useCallback(async (enbox, value: RecordPatchInput<Value>) => {
    assertScope(path, within, active);
    if (id === undefined) throw new TypeError('No record is available to patch.');
    const api = enbox.using(protocol);
    await assertParent(() => api.records.read(path, id), within);
    return api.records.patch(path, id, value);
  }, [protocol, path, within, id, active]), { scope });
  const remove = useEnboxMutation(useCallback(async (enbox, _variables: void) => {
    assertScope(path, within, active);
    if (id === undefined) return;
    const api = enbox.using(protocol);
    await assertParent(() => api.records.read(path, id), within);
    await api.records.delete(path, { recordId: id, ...(within === undefined ? {} : { within }) });
  }, [protocol, path, within, id, active]), { scope });
  const singletonScope = useMemo(() => ({ protocol, path, within, active }), [protocol, path, within, active]);
  const set = useEnboxMutation(useCallback(async (enbox, data: Value) => {
    assertScope(path, within, active);
    return enbox.using(protocol).records.set(path as SingletonPath<D>, {
      data, ...(within === undefined ? {} : { within }),
    } as TypedSetRequest<C, SingletonPath<D>>);
  }, [protocol, path, within, active]), { scope: singletonScope });
  const { records: _rows, loadMore: _load, hasMore: _more, isLoadingMore: _loading, ...state } = query;
  return useMemo(() => Object.freeze({
    ...state, retry, data: row?.value, record: row?.record, isReady: query.status === 'ready', isLoading: query.status === 'loading',
    patch, delete: remove, ...(requestedId === undefined ? { set } : {}),
  }), [query, row, retry, patch, remove, set, requestedId]);
}
