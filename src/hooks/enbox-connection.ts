'use client';

import type { VaultConnectOptions } from '@enbox/browser';

import type {
  ConnectionController, ConnectOptions, DisconnectOptions, EnboxConnectionState,
} from '../internal/connection-controller.js';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useProviderContext } from '../provider.js';

export type {
  BeforeConnect, BeforeDisconnect, ConnectOptions, DisconnectOptions,
  EnboxConnectionState, WalletRepairReason, WalletRepairState,
} from '../internal/connection-controller.js';

export type EnboxConnection = EnboxConnectionState & Readonly<{
  connect(options?: ConnectOptions): Promise<void>;
  connectVault(options?: VaultConnectOptions): Promise<void>;
  disconnect(options?: DisconnectOptions): Promise<void>;
  refreshDwnEndpoints: ConnectionController['refreshDwnEndpoints'];
  retryRemote: ConnectionController['retryRemote'];
}>;

/** Connection presentation and guarded actions that reject actionable failures. */
export function useEnboxConnection(): EnboxConnection {
  const { controller, beforeConnect, beforeDisconnect } = useProviderContext();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const connect = useCallback((options?: ConnectOptions) =>
    controller.connect(options, { beforeConnect }), [controller, beforeConnect]);
  const connectVault = useCallback((options?: VaultConnectOptions) =>
    controller.connectVault(options, { beforeConnect }), [controller, beforeConnect]);
  const disconnect = useCallback((options?: DisconnectOptions) =>
    controller.disconnect(options, { beforeDisconnect }), [controller, beforeDisconnect]);
  return useMemo(() => Object.freeze({ ...state, connect, connectVault, disconnect,
    refreshDwnEndpoints: controller.refreshDwnEndpoints, retryRemote: controller.retryRemote,
  }), [state, connect, connectVault, disconnect, controller]);
}
