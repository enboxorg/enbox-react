'use client';

import type { ConnectionStore } from '@enbox/browser';
import type { ConnectionController, ConnectionPolicy } from './connection-controller.js';
import { createContext, useContext } from 'react';

export type ProviderContext = ConnectionPolicy & Readonly<{ client: ConnectionStore; controller: ConnectionController }>;
export const EnboxContext = createContext<ProviderContext | undefined>(undefined);

export function useProviderContext(): ProviderContext {
  const context = useContext(EnboxContext);
  if (context === undefined) throw new Error('Enbox hooks require an EnboxProvider.');
  return context;
}
export function useEnboxClient(): ConnectionStore { return useProviderContext().client; }
export function useOptionalEnboxClient(): ConnectionStore | undefined { return useContext(EnboxContext)?.client; }
