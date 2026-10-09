'use client';

import type { ConnectionStore } from '@enbox/browser';
import type { ReactNode } from 'react';

import { createContext, useContext, useEffect } from 'react';

const EnboxContext = createContext<ConnectionStore | undefined>(undefined);

export type EnboxProviderProps = {
  client: ConnectionStore;
  children?: ReactNode;
  initializeOnMount?: boolean;
};

/** Borrows the client. The application host owns terminal disposal. */
export function EnboxProvider({
  client,
  children,
  initializeOnMount = true,
}: EnboxProviderProps): ReactNode {
  useEffect(() => {
    if (initializeOnMount) {
      // Native flow errors are published in the returned connection snapshot.
      void client.initialize().catch((cause: unknown) => {
        console.warn('[@enbox/react] Client initialization failed.', cause);
      });
    }
  }, [client, initializeOnMount]);

  return <EnboxContext.Provider value={client}>{children}</EnboxContext.Provider>;
}

/** Returns the borrowed native client for advanced SDK actions. */
export function useEnboxClient(): ConnectionStore {
  const client = useContext(EnboxContext);
  if (client === undefined) {
    throw new Error('Enbox hooks require an EnboxProvider.');
  }
  return client;
}
