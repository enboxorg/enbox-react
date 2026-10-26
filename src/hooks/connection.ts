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

import { useEnboxClient } from '../internal/provider-context.js';

const SERVER_CONNECTION: ConnectionSnapshot = Object.freeze({ phase: 'initializing' });
const getServerSnapshot = (): ConnectionSnapshot => SERVER_CONNECTION;
const selectConnectionSnapshot = (snapshot: ConnectionSnapshot): ConnectionSnapshot => snapshot;

export type ConnectionSelector<Selection> = (snapshot: ConnectionSnapshot) => Selection;
export type EqualityFn<Selection> = (previous: Selection, next: Selection) => boolean;

/**
 * Read the native connection snapshot or a selected value. Selector equality
 * controls updates and defaults to Object.is. Use useEnboxConnection for
 * presentation state and guarded actions.
 */
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
  return useConnectionStore(client, selector ?? (selectConnectionSnapshot as ConnectionSelector<Selection>), isEqual);
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
  | 'connectVault'
  | 'refresh'
  | 'disconnect'
  | 'refreshDwnEndpoints'
  | 'retryRemote'
>;

/** Stable, receiver-bound actions that preserve native snapshot results. */
export function useConnectionActions(): ConnectionActions {
  const client = useEnboxClient();
  return useMemo(() => Object.freeze({
    initialize: client.initialize.bind(client),
    connect: client.connect.bind(client),
    connectVault: client.connectVault.bind(client),
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

/**
 * Bind the published facade to a typed protocol, or return undefined without a
 * facade. The binding is recreated when the facade or protocol reference changes.
 */
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
