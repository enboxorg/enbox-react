'use client';

import type { ApplicationRuntime } from '@enbox/browser';
import type { ReactNode } from 'react';
import { getApplicationWalletOptions } from '@enbox/browser';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { ConnectionController, type ConnectionPolicy } from './internal/connection-controller.js';

type ProviderContext = ConnectionPolicy & Readonly<{
  controller: ConnectionController;
  application: ApplicationRuntime;
}>;
const EnboxContext = createContext<ProviderContext | undefined>(undefined);

export type EnboxProviderProps = ConnectionPolicy & {
  application: ApplicationRuntime;
  children?: ReactNode;
  initializeOnMount?: boolean;
};

/**
 * Borrow an application runtime and expose its stores and connection UI to React.
 * Initialization starts after mount unless disabled. The application's owner is
 * responsible for disposal; unmount only releases React's subscriptions and UI.
 */
export function EnboxProvider({
  application, initializeOnMount = true, beforeConnect, beforeDisconnect, children,
}: EnboxProviderProps): ReactNode {
  const [scope, setScope] = useState(() => ({
    application,
    controller: new ConnectionController(application.connection, getApplicationWalletOptions(application)),
  }));
  if (scope.application !== application || scope.controller.isRetired()) {
    setScope({ application, controller: new ConnectionController(application.connection, getApplicationWalletOptions(application)) });
  }
  const controller = scope.controller;
  useEffect(() => {
    const release = controller.retain();
    return () => {
      release();
      queueMicrotask(() => {
        // Activity can resume unchanged children after the UI workflow retires.
        if (controller.isRetired()) setScope((latest) => latest === scope ? { ...scope } : latest);
      });
    };
  }, [controller, scope]);
  useEffect(() => {
    if (initializeOnMount) {
      void application.initialize().catch((cause: unknown) => {
        console.warn('[@enbox/react] Application initialization failed.', cause);
      });
    }
  }, [application, initializeOnMount]);
  const value = useMemo(() => ({ controller, application, beforeConnect, beforeDisconnect }),
    [controller, application, beforeConnect, beforeDisconnect]);
  return <EnboxContext.Provider value={value}>{children}</EnboxContext.Provider>;
}

export function useProviderContext(): ProviderContext {
  const context = useContext(EnboxContext);
  if (context === undefined) throw new Error('Enbox hooks require an EnboxProvider.');
  return context;
}

/** Borrow the provider's runtime; its native connection is available as application.connection. */
export function useApplication(): ApplicationRuntime { return useProviderContext().application; }
