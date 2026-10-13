'use client';

import type { ConnectionStore } from '@enbox/browser';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { createEnboxClient, type CreateEnboxClientOptions } from './config/client.js';
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

/** Owns a configured client, or borrows an explicitly supplied client. */
export function EnboxProvider(props: EnboxProviderProps): ReactNode {
  return props.client !== undefined
    ? <BorrowedProvider {...props} client={props.client} />
    : <OwnedProvider {...props} config={props.config} />;
}

function initialize(client: ConnectionStore): void {
  void client.initialize().catch((cause: unknown) => {
    console.warn('[@enbox/react] Client initialization failed.', cause);
  });
}

function BorrowedProvider({ client, initializeOnMount = true, ...props }: CommonProps & { client: ConnectionStore }) {
  useEffect(() => { if (initializeOnMount) initialize(client); }, [client, initializeOnMount]);
  return <ClientContext {...props} client={client} />;
}

function OwnedProvider({ config, initializeOnMount = true, ...props }: CommonProps & { config: CreateEnboxClientOptions }) {
  // Configuration belongs to this mounted application scope. Retained React
  // state can outlive its Effects, so a retired native client must be replaced.
  const [scope] = useState(() => ({
    config, client: createEnboxClient(config), generation: 0, retired: false,
  }));
  const [client, setClient] = useState(scope.client);
  const lifetime = useRef(scope);
  useEffect(() => {
    const current = lifetime.current;
    const generation = ++current.generation;
    if (current.retired) {
      current.client = createEnboxClient(current.config);
      current.retired = false;
      setClient(current.client);
    }
    if (initializeOnMount) initialize(current.client);
    return () => {
      queueMicrotask(() => {
        if (current.generation !== generation) return;
        current.retired = true;
        void current.client.dispose().catch((cause: unknown) => {
          console.warn('[@enbox/react] Client disposal failed.', cause);
        });
      });
    };
  }, [initializeOnMount]);
  return <ClientContext {...props} client={client} wallet={scope.config.wallet} />;
}

function ClientContext({ client, wallet, beforeConnect, beforeDisconnect, children }: CommonProps & {
  client: ConnectionStore;
  wallet?: CreateEnboxClientOptions['wallet'];
}) {
  const controller = useMemo(() => new ConnectionController(client, wallet), [client, wallet]);
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
