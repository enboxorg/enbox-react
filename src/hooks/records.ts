'use client';

import type {
  ContextRoleGroups,
  DataForPath,
  ProtocolDefinition,
  ProtocolPaths,
  RecordQuery,
  TypedEnbox,
  TypedMaterializedRecord,
  TypedProtocol,
  TypedRecord,
  TypeNameAtPath,
} from '@enbox/browser';

import { useMemo } from 'react';

import type { RecordViewResult } from './record-view.js';
import { useRecordViewBinding } from './record-view.js';
import { useConnectionStore } from './connection.js';
import { serializeQuery } from '../internal/serialize-query.js';
import {
  isConnectionBindingCurrent,
  sameConnectionBinding,
  selectConnectionBinding,
  subscribeToConnectionBinding,
} from '../internal/connection-binding.js';
import { useOptionalEnboxClient } from '../provider.js';
import { isRecordStore, type RecordStore } from '../config/record-store.js';

/** Derive singleton paths from the native set contract, which owns eligibility. */
type SingletonPaths<Definition extends ProtocolDefinition> =
  Parameters<TypedEnbox<Definition>['records']['set']>[0];

type DirectChildPaths<Paths, Parent extends string> = Paths extends `${Parent}/${infer Child}`
  ? Child extends `${string}/${string}` ? never : Paths
  : never;

type RecordMaterialization<Definition extends ProtocolDefinition, Path extends ProtocolPaths<Definition> & string> =
  true | { children: readonly DirectChildPaths<SingletonPaths<Definition>, Path>[] };

type RecordRepresentation<
  Codecs extends TypedProtocol['codecs'],
  Path extends string,
  Materialization,
> = Materialization extends undefined
  ? TypedRecord<DataForPath<Codecs, Path>>
  : Materialization extends { children: readonly (infer Child extends string)[] }
    ? TypedMaterializedRecord<DataForPath<Codecs, Path>> & Readonly<{
      children: Readonly<{
        [ChildPath in Child as TypeNameAtPath<ChildPath>]: TypedMaterializedRecord<DataForPath<Codecs, ChildPath>> | undefined;
      }>;
    }>
    : TypedMaterializedRecord<DataForPath<Codecs, Path>>;

function assertMaterializationKeys(materialization: unknown): void {
  // Query serialization omits undefined values. Reject unknown own keys first
  // so an invalid native request cannot become valid during that copy.
  if (materialization !== null && typeof materialization === 'object'
    && !Array.isArray(materialization)
    && Object.keys(materialization).some((key) => key !== 'children')) {
    throw new TypeError('Record materialization supports only the children selection.');
  }
}

export type RecordsOptions<
  Definition extends ProtocolDefinition,
  Path extends ProtocolPaths<Definition> & string,
  Materialization extends RecordMaterialization<Definition, Path> | undefined = RecordMaterialization<Definition, Path> | undefined,
> = Omit<RecordQuery<Definition, Path>, 'pagination' | 'within'> & {
    pagination: { limit: number };
    materialize?: Materialization;
    enabled?: boolean;
  } & (Path extends `${string}/${string}` ? { within: string } : { within?: string });

export type RecordsResult<Item> = RecordViewResult<Item> & Readonly<{
  /** Expands the retained prefix. Concurrent calls share one Promise. */
  loadMore: () => Promise<void>;
}>;

/** Observe a bounded selection; null options or enabled: false release it. */
export function useRecords<Item>(store: RecordStore<Item> | null): RecordsResult<Item>;
export function useRecords<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends ProtocolPaths<Definition> & string,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options: (RecordsOptions<Definition, NoInfer<Path>> & { materialize?: never }) | null,
): RecordsResult<TypedRecord<DataForPath<Codecs, Path>>>;
export function useRecords<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends ProtocolPaths<Definition> & string,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options: (RecordsOptions<Definition, NoInfer<Path>> & { materialize: true }) | null,
): RecordsResult<TypedMaterializedRecord<DataForPath<Codecs, Path>>>;
export function useRecords<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends ProtocolPaths<Definition> & string,
  const Materialization extends RecordMaterialization<Definition, NoInfer<Path>> | undefined,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options: (RecordsOptions<Definition, NoInfer<Path>, Materialization> & { materialize: Materialization }) | null,
): RecordsResult<RecordRepresentation<Codecs, Path, Materialization>>;
export function useRecords<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends ProtocolPaths<Definition> & string,
  const Materialization extends RecordMaterialization<Definition, NoInfer<Path>> | undefined,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options: RecordsOptions<Definition, NoInfer<Path>, Materialization> | null,
): RecordsResult<RecordRepresentation<Codecs, Path, Materialization | undefined>>;
export function useRecords<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
  const Path extends ProtocolPaths<Definition> & string,
  Item,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups> | RecordStore<Item> | null,
  path?: Path,
  options?: RecordsOptions<Definition, NoInfer<Path>> | null,
): RecordsResult<
  Item | TypedRecord<DataForPath<Codecs, Path>> | TypedMaterializedRecord<DataForPath<Codecs, Path>>
> {
  const borrowed = protocol === null || isRecordStore<Item>(protocol);
  const client = useOptionalEnboxClient();
  const expected = useConnectionStore(borrowed ? undefined : client, selectConnectionBinding, sameConnectionBinding);
  const typedEnbox = useMemo(() => borrowed ? undefined
    : expected.enbox?.using<Definition, Codecs, RoleGroups>(protocol), [borrowed, expected.enbox, protocol]);
  const enabled = options != null && options.enabled !== false;
  if (options != null) assertMaterializationKeys(options.materialize);
  const serializedQuery = options == null ? null : serializeQuery({
    from: options.from,
    within: options.within,
    protocolRole: options.protocolRole,
    filter: options.filter,
    dateSort: options.dateSort,
    pagination: options.pagination,
    materialize: options.materialize,
  });
  const bindingGuard = useMemo(() => ({
    isCurrent: () => client !== undefined && isConnectionBindingCurrent(client, expected),
    subscribe: (notify: () => void) => client === undefined ? () => {}
      : subscribeToConnectionBinding(client, expected, notify),
  }), [client, expected]);
  const opener = useMemo(() => {
    if (!enabled || path === undefined || typedEnbox === undefined || serializedQuery === null) return null;
    // Own a copy of the serialized request so caller mutations cannot change it.
    const request = JSON.parse(serializedQuery) as RecordsOptions<Definition, Path>;
    return async (signal: AbortSignal) => typedEnbox.records.observe(path, {
      ...request,
      signal,
    } as Parameters<typeof typedEnbox.records.observe>[1]);
  }, [typedEnbox, path, serializedQuery, enabled]);
  const { snapshot, observer } = useRecordViewBinding<
    Item | TypedRecord<DataForPath<Codecs, Path>> | TypedMaterializedRecord<DataForPath<Codecs, Path>>
  >(borrowed ? protocol as RecordStore<Item> | null : opener, borrowed ? undefined : bindingGuard);
  const result = useMemo(
    () => Object.freeze({ ...snapshot, loadMore: observer.loadMore }),
    [snapshot, observer],
  );
  if (!borrowed && client === undefined) throw new Error('Enbox hooks require an EnboxProvider.');
  return result;
}
