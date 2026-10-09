'use client';

import type {
  ContextRoleGroups,
  DataForPath,
  ProtocolDefinition,
  ProtocolPaths,
  RecordQuery,
  TypedMaterializedRecord,
  TypedProtocol,
  TypedRecord,
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

export type RecordsOptions<
  Definition extends ProtocolDefinition,
  Path extends ProtocolPaths<Definition> & string,
> = Omit<RecordQuery<Definition, Path>, 'pagination' | 'within'> & {
    pagination: { limit: number };
    materialize?: true;
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
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
  path: Path,
  options: RecordsOptions<Definition, NoInfer<Path>> | null,
): RecordsResult<
  TypedRecord<DataForPath<Codecs, Path>> | TypedMaterializedRecord<DataForPath<Codecs, Path>>
>;
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
    const request = JSON.parse(serializedQuery) as Omit<RecordQuery<Definition, Path>, 'pagination'> & {
      pagination: { limit: number };
      materialize?: true;
    };
    const { materialize, ...query } = request;
    return async (signal: AbortSignal) => materialize === true
      ? typedEnbox.records.observe(path, { ...query, materialize: true, signal })
      : typedEnbox.records.observe(path, { ...query, signal });
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
