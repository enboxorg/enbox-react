'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type {
  ConnectOptions, DisconnectOptions, EnboxConnectionState,
} from '../internal/connection-controller.js';
import { useProviderContext } from '../provider.js';

export type {
  BeforeConnect, BeforeDisconnect, ConnectOptions, DisconnectOptions,
  EnboxConnectionState, WalletRepairReason, WalletRepairState,
} from '../internal/connection-controller.js';

export type EnboxConnection = EnboxConnectionState & Readonly<{
  connect(options?: ConnectOptions): Promise<void>;
  disconnect(options?: DisconnectOptions): Promise<void>;
  refreshDwnEndpoints: import('../internal/connection-controller.js').ConnectionController['refreshDwnEndpoints'];
  retryRemote: import('../internal/connection-controller.js').ConnectionController['retryRemote'];
}>;

/** Connection presentation, async guards, and wallet repair for a dapp. */
export function useEnboxConnection(): EnboxConnection {
  const { controller, beforeConnect, beforeDisconnect } = useProviderContext();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const connect = useCallback((options?: ConnectOptions) =>
    controller.connect(options, { beforeConnect }), [controller, beforeConnect]);
  const disconnect = useCallback((options?: DisconnectOptions) =>
    controller.disconnect(options, { beforeDisconnect }), [controller, beforeDisconnect]);
  return useMemo(() => Object.freeze({ ...state, connect, disconnect,
    refreshDwnEndpoints: controller.refreshDwnEndpoints, retryRemote: controller.retryRemote,
  }), [state, connect, disconnect, controller]);
}
