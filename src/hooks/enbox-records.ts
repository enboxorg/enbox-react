'use client';

import type { ContextRoleGroups, DataForPath, ProtocolDefinition, RecordPatchInput, TypedProtocol } from '@enbox/browser';
import type { DataRecordPath, EnboxRecordItem, EnboxRecordOptions, EnboxRecordsOptions, EnboxRecordStore, EnboxSingletonOptions } from '../config/record-types.js';
import type { EnboxMutationResult } from './mutation.js';
import type { EnboxMutationScope } from './mutation.js';
import type { RecordsResult } from './records.js';
import type { SingletonPaths } from '../internal/singleton-paths.js';

import { useCallback, useMemo } from 'react';

import { EnboxBindingChangedError } from '../errors.js';
import { BoundRecordStore, copyLocalQuery } from '../internal/bound-record-store.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';
import { sameConnectionBinding, selectConnectionBinding } from '../internal/connection-binding.js';
import { isSingletonPath } from '../internal/singleton-paths.js';
import { serializeQuery } from '../internal/serialize-query.js';
import { useClientMutation } from './mutation.js';
import { useConnectionStore } from './connection.js';
import { useObservableStore } from './observable-store.js';
import { useOptionalEnboxClient } from '../provider.js';

export type { EnboxRecordItem, EnboxRecordOptions, EnboxRecordsOptions, EnboxSingletonOptions } from '../config/record-types.js';
type ScopeArguments<Path extends string, Options> = Path extends `${string}/${string}` ? [options: Options | null] : [options?: Options | null];

type CollectionQueryResult<State> = State extends unknown
  ? State & Readonly<{ isReady: boolean; isLoading: boolean }>
  : never;
export type EnboxRecordsResult<T> = CollectionQueryResult<RecordsResult<EnboxRecordItem<T>>> & Readonly<{
  scope: EnboxMutationScope;
  create: EnboxMutationResult<T, EnboxRecordItem<T>>;
  patch: EnboxMutationResult<{ id: string; patch: RecordPatchInput<T> }, EnboxRecordItem<T>> & { isPendingFor(id: string): boolean };
  delete: EnboxMutationResult<string, void> & { isPendingFor(id: string): boolean };
}>;
type SingleRecordQueryResult<State, T> = State extends unknown
  ? Omit<State, 'records' | 'hasMore' | 'loadMore' | 'isLoadingMore'> & (EnboxRecordItem<T> | Readonly<{
    [Field in keyof EnboxRecordItem<T>]: undefined;
  }>) & Readonly<{
    isReady: boolean;
    isLoading: boolean;
    isMissing: boolean;
  }> : never;
export type EnboxRecordResult<T> = SingleRecordQueryResult<RecordsResult<EnboxRecordItem<T>>, T> & Readonly<{
  scope: EnboxMutationScope;
  patch: EnboxMutationResult<RecordPatchInput<T>, EnboxRecordItem<T>>;
  delete: EnboxMutationResult<void, void>;
}>;
export type EnboxSingletonResult<T> = EnboxRecordResult<T> & Readonly<{
  set: EnboxMutationResult<T, EnboxRecordItem<T>>;
}>;

const idleView = new RecordViewObserver<EnboxRecordItem<unknown>>(null);
const IDLE = Object.freeze({ ...idleView.getServerSnapshot(), selection: null });
const inactive = async (): Promise<never> => { throw new EnboxBindingChangedError(); };
const INACTIVE: BoundRecordStore<unknown>['commands'] = Object.freeze({ key: Object.freeze({}), isCurrent: () => false,
  create: inactive, patch: inactive, delete: inactive, set: inactive });

function useHandledControl(control: () => Promise<void>): () => Promise<void> {
  return useCallback(() => {
    const result = control();
    void result.catch(() => {});
    return result;
  }, [control]);
}

function useBoundQuery(source: unknown, path: string | undefined, value: object | null | undefined, override = false) {
  const supplied = source instanceof BoundRecordStore ? source as BoundRecordStore<unknown> : undefined;
  const providerClient = useOptionalEnboxClient();
  const client = supplied?.client ?? providerClient;
  if (client === undefined) throw new Error('Enbox hooks require an EnboxProvider or an explicit record store.');
  const binding = useConnectionStore(client, selectConnectionBinding, sameConnectionBinding);
  const protocol = supplied?.protocol ?? source as TypedProtocol;
  const query = copyLocalQuery(value === undefined ? {} : value);
  const queryKey = serializeQuery(query);
  const within = query === null ? undefined : (query as { within?: string }).within;
  const active = query !== null;
  const sourceSelection = useObservableStore(override ? supplied?.selectionSource : undefined, null);
  const commandScope = useMemo(() => ({}), [client, binding, protocol, path, within, active]);
  const store = useMemo(() => supplied !== undefined && (!supplied.isCurrent() || !override || supplied.matches(JSON.parse(queryKey)))
    ? supplied : source === null ? undefined : new BoundRecordStore<unknown>(
      { client, protocol, path: path!, options: JSON.parse(queryKey), pageSize: supplied?.pageSize ?? 20,
        ...(supplied === undefined ? {} : { signal: supplied.signal }) }, false, binding, commandScope,
    ), [supplied, source, sourceSelection, override, client, protocol, path, queryKey, binding, commandScope]);
  const state = useObservableStore(store, store?.getServerSnapshot() ?? IDLE);
  return { client, store, state, commands: store?.commands ?? INACTIVE };
}

function useRecordMutation<Variables, Result>(
  query: ReturnType<typeof useBoundQuery>, operation: (variables: Variables) => Promise<Result>,
  scope: EnboxMutationScope = query.commands,
): EnboxMutationResult<Variables, Result> {
  const run = useCallback((_enbox: unknown, variables: Variables) => operation(variables), [operation]);
  return useClientMutation(query.client, run, { scope });
}

/** Borrow a controller's owner, including an absent owner during workspace startup. */
export function useEnboxRecords<T, Selection, Path extends string, Singleton extends boolean>(
  store: EnboxRecordStore<T, Selection, Path, Singleton> | null, options?: Selection | null,
): EnboxRecordsResult<T>;
export function useEnboxRecords<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends DataRecordPath<D>>(protocol: TypedProtocol<D, C, R>, path: Path,
    ...args: ScopeArguments<Path, EnboxRecordsOptions<D, NoInfer<Path>>>): EnboxRecordsResult<DataForPath<C, Path>>;
export function useEnboxRecords(source: unknown, path?: string | object | null, options?: object | null): unknown {
  const supplied = source instanceof BoundRecordStore ? source as BoundRecordStore<unknown> : undefined;
  const query = useBoundQuery(source, supplied?.path ?? path as string | undefined,
    supplied === undefined ? options : path as object | null | undefined, supplied !== undefined && path !== undefined);
  const commands = query.commands;
  const create = useRecordMutation(query, commands.create);
  const patch = useRecordMutation(query, commands.patch);
  const remove = useRecordMutation(query, useCallback((id: string) => commands.delete(id), [commands]));
  const retry = useHandledControl(query.state.retry);
  const loadMore = useHandledControl(query.store?.loadMore ?? inactive);
  return useMemo(() => {
    const { selection: _selection, ...state } = query.state;
    return Object.freeze({ ...state, retry, loadMore, scope: commands,
      isReady: state.status === 'ready', isLoading: state.status === 'loading', create,
      patch: Object.freeze({ ...patch, isPendingFor: (id: string) => patch.pendingVariables.some((input) => input.id === id) }),
      delete: Object.freeze({ ...remove, isPendingFor: (id: string) => remove.pendingVariables.includes(id) }),
    });
  }, [query.state, commands, retry, loadMore, create, patch, remove]);
}

export function useEnboxRecord<T, Selection, Path extends string>(store: EnboxRecordStore<T, Selection, Path, true>): EnboxSingletonResult<T>;
export function useEnboxRecord<T, Selection, Path extends string>(store: EnboxRecordStore<T, Selection, Path>): EnboxRecordResult<T>;
export function useEnboxRecord<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends SingletonPaths<D> & DataRecordPath<D>>(protocol: TypedProtocol<D, C, R>, path: Path,
    ...args: ScopeArguments<Path, EnboxSingletonOptions<NoInfer<Path>>>): EnboxSingletonResult<DataForPath<C, Path>>;
export function useEnboxRecord<D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends DataRecordPath<D>>(protocol: TypedProtocol<D, C, R>, path: Path,
    options: EnboxRecordOptions<Path> | null): EnboxRecordResult<DataForPath<C, Path>>;
export function useEnboxRecord(source: unknown, path?: string, options?: object | null): unknown {
  const supplied = source instanceof BoundRecordStore ? source as BoundRecordStore<unknown> : undefined;
  const protocol = supplied?.protocol ?? source as TypedProtocol;
  const recordPath = supplied?.path ?? path!;
  const hasRecordId = options != null && Object.hasOwn(options, 'recordId');
  const copied = copyLocalQuery(options === undefined ? {} : options) as { within?: string; recordId?: string; enabled?: boolean } | null;
  if (hasRecordId && (typeof copied?.recordId !== 'string' || !copied.recordId.trim())) {
    throw new TypeError('useEnboxRecord requires a nonempty recordId.');
  }
  const query = useBoundQuery(source, recordPath, copied === null ? null : {
    ...(copied.within === undefined ? {} : { within: copied.within }),
    ...(copied.enabled === undefined ? {} : { enabled: copied.enabled }),
    filter: copied.recordId === undefined ? {} : { recordId: copied.recordId }, pagination: { limit: 1 },
  });
  const selection = query.state.selection;
  const recordId = supplied === undefined ? copied?.recordId : selection?.filter?.recordId;
  const byId = supplied === undefined ? hasRecordId : recordId !== undefined;
  const singleton = isSingletonPath(protocol.definition, recordPath);
  if (selection !== null && (!byId && !singleton || byId && (typeof recordId !== 'string' || !recordId.trim()))) {
    throw new TypeError('useEnboxRecord requires a recordId unless the path declares $recordLimit.max: 1.');
  }
  if (supplied !== undefined && selection !== null && (Object.keys(selection.filter ?? {}).some((key) => key !== 'recordId') || singleton && byId)) {
    throw new TypeError('A shared single-record query must select one ID or an unfiltered singleton.');
  }
  const commands = query.commands;
  const recordScope = supplied?.recordScope;
  const scope = useMemo(() => Object.freeze({ key: {},
    isCurrent: (): boolean => commands.isCurrent() && (supplied === undefined || supplied.recordScope === recordScope),
    ...(commands.subscribe === undefined ? {} : { subscribe: commands.subscribe }),
  }), [commands.key, recordScope, recordId, byId]);
  const patch = useRecordMutation(query, useCallback((patch: RecordPatchInput<unknown>) => commands.patch(
    recordId === undefined ? { patch } : { id: recordId, patch },
  ), [commands, recordId]), scope);
  const remove = useRecordMutation(query, useCallback((_variables: void) => commands.delete(recordId), [commands, recordId]), scope);
  const set = useRecordMutation(query, commands.set, scope);
  const retry = useHandledControl(query.state.retry);
  const row = query.state.records[0];
  return useMemo(() => {
    const { records: _records, hasMore: _more, isLoadingMore: _loading, selection: _selection, ...state } = query.state;
    return Object.freeze({ ...state, retry, scope, id: row?.id, contextId: row?.contextId,
      dateCreated: row?.dateCreated, timestamp: row?.timestamp, data: row?.data, record: row?.record,
      isReady: state.status === 'ready', isLoading: state.status === 'loading',
      isMissing: state.status === 'ready' && row === undefined,
      patch, delete: remove, ...(singleton && !byId ? { set } : {}),
    });
  }, [query.state, row, retry, scope, patch, remove, set, singleton, byId]);
}
