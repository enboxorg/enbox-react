'use client';

import type {
  ConnectionSnapshot,
  ConnectionStore,
  ContextRoleGroups,
  ProtocolDefinition,
  TypedEnbox,
  TypedProtocol,
} from '@enbox/browser';

import { useCallback, useMemo } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

import { useEnboxClient } from '../provider.js';

const SERVER_CONNECTION: ConnectionSnapshot = Object.freeze({ phase: 'initializing' });
const getServerSnapshot = (): ConnectionSnapshot => SERVER_CONNECTION;
const identity = (snapshot: ConnectionSnapshot): ConnectionSnapshot => snapshot;

export type ConnectionSelector<Selection> = (snapshot: ConnectionSnapshot) => Selection;
export type EqualityFn<Selection> = (previous: Selection, next: Selection) => boolean;

export function useConnection(): ConnectionSnapshot;
export function useConnection<Selection>(
  selector: ConnectionSelector<Selection>,
  isEqual?: EqualityFn<Selection>,
): Selection;
export function useConnection<Selection>(
  selector?: ConnectionSelector<Selection>,
  isEqual?: EqualityFn<Selection>,
): ConnectionSnapshot | Selection {
  const client = useEnboxClient();
  return useConnectionStore(client, selector ?? (identity as ConnectionSelector<Selection>), isEqual);
}

const noop = (): void => {};

export function useConnectionStore<Selection>(
  client: ConnectionStore | undefined,
  select: ConnectionSelector<Selection>,
  isEqual?: EqualityFn<Selection>,
): Selection {
  const subscribe = useCallback((notify: () => void) => client?.subscribe(notify) ?? noop, [client]);
  const getSnapshot = useCallback(() => client?.getSnapshot() ?? SERVER_CONNECTION, [client]);
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getServerSnapshot,
    select,
    isEqual ?? Object.is,
  );
}

export type ConnectionActions = Pick<
  ConnectionStore,
  | 'initialize'
  | 'connect'
  | 'refresh'
  | 'disconnect'
  | 'refreshDwnEndpoints'
  | 'retryRemote'
>;

export function useConnectionActions(): ConnectionActions {
  const client = useEnboxClient();
  return useMemo(() => Object.freeze({
    initialize: client.initialize.bind(client),
    connect: client.connect.bind(client),
    refresh: client.refresh.bind(client),
    disconnect: client.disconnect.bind(client),
    refreshDwnEndpoints: client.refreshDwnEndpoints.bind(client),
    retryRemote: client.retryRemote.bind(client),
  }), [client]);
}

const selectEnbox = (snapshot: ConnectionSnapshot): ConnectionSnapshot['enbox'] => snapshot.enbox;
const selectIdentity = (snapshot: ConnectionSnapshot) => snapshot.session?.identity;
const selectSync = (snapshot: ConnectionSnapshot): ConnectionSnapshot['sync'] => snapshot.sync;

export function useEnbox(): ConnectionSnapshot['enbox'] {
  return useConnection(selectEnbox);
}

export function useIdentity(): NonNullable<ConnectionSnapshot['session']>['identity'] | undefined {
  return useConnection(selectIdentity);
}

export function useSyncStatus(): ConnectionSnapshot['sync'] {
  return useConnection(selectSync);
}

export function useProtocol<
  Definition extends ProtocolDefinition,
  Codecs extends TypedProtocol['codecs'],
  RoleGroups extends ContextRoleGroups,
>(
  protocol: TypedProtocol<Definition, Codecs, RoleGroups>,
): TypedEnbox<Definition, Codecs, RoleGroups> | undefined {
  const enbox = useEnbox();
  return useMemo(
    () => enbox?.using<Definition, Codecs, RoleGroups>(protocol),
    [enbox, protocol],
  );
}
