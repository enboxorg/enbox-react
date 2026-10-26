'use client';

import type { ConnectionStore } from '@enbox/browser';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { createEnboxClient, getClientWalletOptions, type CreateEnboxClientOptions } from './config/client.js';
import { ConnectionController, type ConnectionPolicy } from './internal/connection-controller.js';

type ProviderContext = ConnectionPolicy & Readonly<{
  client: ConnectionStore;
  controller: ConnectionController;
}>;
const EnboxContext = createContext<ProviderContext | undefined>(undefined);

type CommonProps = ConnectionPolicy & {
  children?: ReactNode;
  initializeOnMount?: boolean;
};
export type EnboxProviderProps = CommonProps & (
  | { client: ConnectionStore; config?: never }
  | { config: CreateEnboxClientOptions; client?: never }
);

/** Creates and disposes a client from config, or reuses a client whose disposal stays with its caller. */
export function EnboxProvider(props: EnboxProviderProps): ReactNode {
  return props.client !== undefined
    ? <ExistingClientProvider {...props} client={props.client} />
    : <ConfiguredProvider {...props} config={props.config} />;
}

function initializeClient(client: ConnectionStore): void {
  void client.initialize().catch((cause: unknown) => {
    console.warn('[@enbox/react] Client initialization failed.', cause);
  });
}

function ExistingClientProvider({
  client, initializeOnMount = true, ...props
}: CommonProps & { client: ConnectionStore }) {
  useEffect(() => { if (initializeOnMount) initializeClient(client); }, [client, initializeOnMount]);
  return <ConnectionContextProvider {...props} client={client} />;
}

function ConfiguredProvider({
  config, initializeOnMount = true, ...props
}: CommonProps & { config: CreateEnboxClientOptions }) {
  // Capture the mounted configuration; changing it requires a new provider key.
  // Activity can retain this state after Effects have retired its native client.
  const [scope, setScope] = useState(() => ({
    config, client: createEnboxClient(config), generation: 0, retired: false,
  }));
  if (scope.retired) {
    // Updating this component's state during render makes React retry it before
    // rendering children. Creating an inert client is safe in an abandoned render.
    setScope({
      config: scope.config, client: createEnboxClient(scope.config), generation: 0, retired: false,
    });
  }
  useEffect(() => {
    const current = scope;
    const generation = ++current.generation;
    if (initializeOnMount) initializeClient(current.client);
    return () => {
      queueMicrotask(() => {
        if (current.generation !== generation) return;
        current.retired = true;
        void current.client.dispose().catch((cause: unknown) => {
          console.warn('[@enbox/react] Client disposal failed.', cause);
        });
        // Activity may reactivate Effects without rendering unchanged children.
        // Schedule the replacement while hidden so resume Effects receive it.
        setScope((latest) => latest === current ? { ...current } : latest);
      });
    };
  }, [scope, initializeOnMount]);
  return <ConnectionContextProvider {...props} client={scope.client} />;
}

function ConnectionContextProvider({ client, beforeConnect, beforeDisconnect, children }: CommonProps & {
  client: ConnectionStore;
}) {
  const [scope, setScope] = useState(() => ({
    client,
    controller: new ConnectionController(client, getClientWalletOptions(client)),
  }));
  if (scope.client !== client || scope.controller.isRetired()) {
    setScope({ client, controller: new ConnectionController(client, getClientWalletOptions(client)) });
  }
  const controller = scope.controller;
  useEffect(() => {
    const release = controller.retain();
    return () => {
      release();
      queueMicrotask(() => {
        // Check after retain()'s deferred release so Strict Mode replay can reclaim it.
        if (controller.isRetired()) setScope((latest) => latest === scope ? { ...scope } : latest);
      });
    };
  }, [controller, scope]);
  const value = useMemo(() => ({ client, controller, beforeConnect, beforeDisconnect }),
    [client, controller, beforeConnect, beforeDisconnect]);
  return <EnboxContext.Provider value={value}>{children}</EnboxContext.Provider>;
}

export function useProviderContext(): ProviderContext {
  const context = useContext(EnboxContext);
  if (context === undefined) throw new Error('Enbox hooks require an EnboxProvider.');
  return context;
}

/** Returns the native client for advanced SDK actions. */
export function useEnboxClient(): ConnectionStore { return useProviderContext().client; }

export function useOptionalEnboxClient(): ConnectionStore | undefined {
  return useContext(EnboxContext)?.client;
}
