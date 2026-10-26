'use client';

import type {
  ContextRoleGroups, DataForPath, ProtocolDefinition, RecordPatchInput, TypedProtocol, TypedRecord,
} from '@enbox/browser';
import type {
  AnyEnboxRecordStore, CommandScope, DataRecordPath, EnboxRecordCommands, EnboxRecordOptions, EnboxRecordsCommands,
  EnboxRecordsOptions, EnboxRecordsSnapshot, EnboxRecordSnapshot, EnboxSingletonCommands, EnboxSingletonOptions,
  EnboxSingletonSnapshot, EnboxRecordStore, RecordKind,
} from '../config/record-types.js';
import type { EnboxMutationResult } from './mutation.js';
import type { SingletonPaths } from '../internal/singleton-paths.js';

import { useCallback, useMemo } from 'react';

import { EnboxBindingChangedError } from '../errors.js';
import { isEnboxRecordStore } from '../internal/enbox-record-store.js';
import { singleRecordKind } from '../internal/record-commands.js';
import { useClientMutation } from './mutation.js';
import { useObservableStore } from './observable-store.js';
import { useRecordOwner } from './record-owner.js';
import { handledQuery } from '../internal/query-control.js';

export type { EnboxRecordItem, EnboxRecordOptions, EnboxRecordsOptions, EnboxSingletonOptions } from '../config/record-types.js';

type WithoutOwner<State> = State extends unknown ? Omit<State, 'commands' | 'selection'> : never;
export type EnboxRecordsResult<T> = WithoutOwner<EnboxRecordsSnapshot<T, unknown>> & Readonly<{
  create: EnboxMutationResult<T, TypedRecord<T>>;
  patch: EnboxMutationResult<{ id: string; patch: RecordPatchInput<T> }, TypedRecord<T>> & { isPendingFor(id: string): boolean };
  delete: EnboxMutationResult<string, void> & { isPendingFor(id: string): boolean };
}>;
export type EnboxRecordResult<T> = WithoutOwner<EnboxRecordSnapshot<T, unknown>> & Readonly<{
  patch: EnboxMutationResult<RecordPatchInput<T>, TypedRecord<T>>;
  delete: EnboxMutationResult<void, void>;
}>;
export type EnboxSingletonResult<T> = EnboxRecordResult<T> & Readonly<{ set: EnboxMutationResult<T, TypedRecord<T>> }>;

type BoundOwner<T, Selection, Kind extends RecordKind> = Readonly<{
  store: EnboxRecordStore<T, Selection, Kind>;
  selection: Readonly<Selection> | null;
}>;
export type EnboxRecordsBinding<T, Selection> = EnboxRecordsResult<T> & BoundOwner<T, Selection, 'collection'>;
export type EnboxRecordBinding<T, Selection> = EnboxRecordResult<T> & BoundOwner<T, Selection, 'record'>;
export type EnboxSingletonBinding<T, Selection> = EnboxSingletonResult<T> & BoundOwner<T, Selection, 'singleton'>;

function useHandledControl<Args extends unknown[]>(control: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> {
  return useCallback((...args: Args) => {
    return handledQuery(control(...args));
  }, [control]);
}

function useRecordMutation<Variables, Result>(
  store: AnyEnboxRecordStore, commands: CommandScope, operation: (variables: Variables) => Promise<Result>,
): EnboxMutationResult<Variables, Result> {
  const run = useCallback((_enbox: unknown, variables: Variables) => {
    if (!commands.isCurrent()) throw new EnboxBindingChangedError();
    return operation(variables);
  }, [commands, operation]);
  const mutation = useClientMutation(store.client, run, { scope: commands.scope });
  return useMemo(() => Object.freeze({
    ...mutation, isCurrent: (): boolean => mutation.isCurrent() && commands.isCurrent(),
  }), [mutation, commands]);
}

/** Observe a parameterized collection or borrow an explicit controller-owned store. */
export function useEnboxRecords<T, Selection>(
  source: EnboxRecordStore<T, Selection, 'collection'>,
): EnboxRecordsBinding<T, Selection>;
export function useEnboxRecords<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends DataRecordPath<D>,
>(protocol: TypedProtocol<D, C, R>, path: Path,
  ...args: Path extends `${string}/${string}`
    ? [options: EnboxRecordsOptions<D, NoInfer<Path>> | null]
    : [options?: EnboxRecordsOptions<D, NoInfer<Path>> | null]
): EnboxRecordsResult<DataForPath<C, Path>>;
export function useEnboxRecords(source: unknown, path?: string, options?: object | null): unknown {
  const borrowsStore = isEnboxRecordStore(source);
  const store = useRecordOwner(source, path, options, 'collection');
  if (store.kind !== 'collection') throw new TypeError('useEnboxRecords requires a collection store.');
  const snapshot = useObservableStore(store, store.getServerSnapshot()) as EnboxRecordsSnapshot<unknown, unknown>;
  const commands = snapshot.commands as EnboxRecordsCommands<unknown>;
  const create = useRecordMutation(store, commands, useCallback((data: unknown) => commands.create(data), [commands]));
  const patch = useRecordMutation(store, commands, useCallback(
    (variables: { id: string; patch: RecordPatchInput<unknown> }) => commands.patch(variables), [commands],
  ));
  const remove = useRecordMutation(store, commands, useCallback((id: string) => commands.delete(id), [commands]));
  const retry = useHandledControl(snapshot.retry);
  const loadMore = useHandledControl(snapshot.loadMore);
  return useMemo(() => {
    const { commands: _commands, selection, ...state } = snapshot;
    return Object.freeze({
      ...state, ...(borrowsStore ? { store, selection } : {}), retry, loadMore, create,
      patch: Object.freeze({ ...patch, isPendingFor: (id: string) => patch.pendingVariables.some((variables) => variables.id === id) }),
      delete: Object.freeze({ ...remove, isPendingFor: (id: string) => remove.pendingVariables.includes(id) }),
    });
  }, [snapshot, borrowsStore, store, retry, loadMore, create, patch, remove]);
}

export function useEnboxRecord<T, Selection>(
  source: EnboxRecordStore<T, Selection, 'singleton'>,
): EnboxSingletonBinding<T, Selection>;
export function useEnboxRecord<T, Selection>(
  source: EnboxRecordStore<T, Selection, 'record'>,
): EnboxRecordBinding<T, Selection>;
export function useEnboxRecord<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends SingletonPaths<D> & DataRecordPath<D>,
>(protocol: TypedProtocol<D, C, R>, path: Path,
  ...args: Path extends `${string}/${string}` ? [options: EnboxSingletonOptions<NoInfer<Path>> | null]
    : [options?: EnboxSingletonOptions<NoInfer<Path>> | null]
): EnboxSingletonResult<DataForPath<C, Path>>;
export function useEnboxRecord<
  D extends ProtocolDefinition, C extends TypedProtocol['codecs'], R extends ContextRoleGroups,
  const Path extends DataRecordPath<D>,
>(protocol: TypedProtocol<D, C, R>, path: Path, options: EnboxRecordOptions<Path> | null): EnboxRecordResult<DataForPath<C, Path>>;
export function useEnboxRecord(source: unknown, path?: string, options?: object | null): unknown {
  const borrowsStore = isEnboxRecordStore(source);
  const kind = isEnboxRecordStore(source) ? source.kind : singleRecordKind(source as TypedProtocol, path!, options);
  const store = useRecordOwner(source, path, options, kind);
  if (store.kind === 'collection') throw new TypeError('useEnboxRecord requires a record or singleton store.');
  const snapshot = useObservableStore(store, store.getServerSnapshot()) as EnboxRecordSnapshot<unknown, unknown> | EnboxSingletonSnapshot<unknown, unknown>;
  const commands = snapshot.commands as EnboxRecordCommands<unknown> | EnboxSingletonCommands<unknown>;
  const patch = useRecordMutation(store, commands, useCallback((value: RecordPatchInput<unknown>) => commands.patch(value), [commands]));
  const remove = useRecordMutation(store, commands, useCallback((_variables: void) => commands.delete(), [commands]));
  const set = useRecordMutation(store, commands, useCallback((data: unknown) => {
    if (!('set' in commands)) throw new TypeError('Only a singleton selection exposes set().');
    return commands.set(data);
  }, [commands]));
  const retry = useHandledControl(snapshot.retry);
  return useMemo(() => {
    const { commands: _commands, selection, ...state } = snapshot;
    return Object.freeze({ ...state, ...(borrowsStore ? { store, selection } : {}), retry, patch, delete: remove,
      ...(store.kind === 'singleton' ? { set } : {}) });
  }, [snapshot, borrowsStore, store, retry, patch, remove, set]);
}
