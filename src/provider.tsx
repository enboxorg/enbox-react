'use client';

import type { ApplicationRuntime, ConnectionStore } from '@enbox/browser';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { createEnboxClient, getClientWalletOptions, type CreateEnboxClientOptions } from './config/client.js';
import { ConnectionController, type ConnectionPolicy } from './internal/connection-controller.js';

type ProviderContext = ConnectionPolicy & Readonly<{
  client: ConnectionStore;
  controller: ConnectionController;
  application?: ApplicationRuntime | undefined;
}>;
const EnboxContext = createContext<ProviderContext | undefined>(undefined);

type CommonProps = ConnectionPolicy & {
  children?: ReactNode;
  initializeOnMount?: boolean;
};
export type EnboxProviderProps = CommonProps & (
  | { application: ApplicationRuntime; client?: never; config?: never }
  | { client: ConnectionStore; config?: never; application?: never }
  | { config: CreateEnboxClientOptions; client?: never; application?: never }
);

/**
 * Expose an application runtime or native connection to React.
 * Supplied applications and clients stay caller-owned; the config form owns its
 * constructed client. Initialization starts after mount unless disabled with
 * initializeOnMount. Unmounting releases React consumers and never disposes a
 * supplied application or client.
 */
export function EnboxProvider(props: EnboxProviderProps): ReactNode {
  if (props.application !== undefined) return <ApplicationProvider {...props} application={props.application} />;
  if (props.client !== undefined) return <ExistingClientProvider {...props} client={props.client} />;
  if (props.config !== undefined) return <ConfiguredProvider {...props} config={props.config} />;
  throw new TypeError('EnboxProvider requires an application, client, or config.');
}

function ApplicationProvider({ application, initializeOnMount = true, ...props }: CommonProps & {
  application: ApplicationRuntime;
}) {
  useEffect(() => {
    if (initializeOnMount) {
      void application.initialize().catch((cause: unknown) => {
        console.warn('[@enbox/react] Application initialization failed.', cause);
      });
    }
  }, [application, initializeOnMount]);
  return <ConnectionContextProvider {...props} application={application} client={application.connection} />;
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

function ConnectionContextProvider({ client, application, beforeConnect, beforeDisconnect, children }: CommonProps & {
  client: ConnectionStore;
  application?: ApplicationRuntime;
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
  const value = useMemo(() => ({ client, controller, application, beforeConnect, beforeDisconnect }),
    [client, controller, application, beforeConnect, beforeDisconnect]);
  return <EnboxContext.Provider value={value}>{children}</EnboxContext.Provider>;
}

export function useProviderContext(): ProviderContext {
  const context = useContext(EnboxContext);
  if (context === undefined) throw new Error('Enbox hooks require an EnboxProvider.');
  return context;
}

/** Returns the native client for advanced SDK actions. */
export function useEnboxClient(): ConnectionStore { return useProviderContext().client; }

/**
 * Borrow the runtime supplied through EnboxProvider's application prop.
 * The returned instance is shared with headless controllers; this hook neither
 * initializes nor disposes it.
 * @throws When the provider has no application runtime.
 */
export function useApplication(): ApplicationRuntime {
  const application = useProviderContext().application;
  if (application === undefined) throw new Error('useApplication and useFeature require an EnboxProvider with an application.');
  return application;
}

export function useOptionalEnboxClient(): ConnectionStore | undefined {
  return useContext(EnboxContext)?.client;
}
