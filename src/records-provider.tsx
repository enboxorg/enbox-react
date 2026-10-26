'use client';

import type { ReactNode } from 'react';
import type { AnyEnboxRecordStore, AnyRecordDefinition } from './config/record-definition.js';

import { createContext, useContext, useMemo } from 'react';

import { isRecordDefinition } from './config/record-definition.js';
import { EnboxRecordOwner, isEnboxRecordStore } from './internal/enbox-record-store.js';
import { sameConnectionBinding, selectConnectionBinding } from './internal/connection-binding.js';
import { useConnectionStore } from './hooks/connection.js';
import { useOptionalEnboxClient } from './internal/provider-context.js';

export type EnboxRecordSources = Readonly<Record<string, AnyRecordDefinition | AnyEnboxRecordStore>>;
const RecordOwners = createContext<ReadonlyMap<AnyRecordDefinition, AnyEnboxRecordStore> | undefined>(undefined);

/** Register lazy session-bound owners. Explicit stores remain owned by their caller. */
export function EnboxRecordsProvider({ records, children }: { records: EnboxRecordSources; children: ReactNode }) {
  const parentOwners = useContext(RecordOwners);
  const client = useOptionalEnboxClient();
  const binding = useConnectionStore(client, selectConnectionBinding, sameConnectionBinding);
  const owners = useMemo(() => {
    const result = new Map<AnyRecordDefinition, AnyEnboxRecordStore>();
    // Supplied stores take ownership precedence over their definition defaults.
    for (const source of Object.values(records)) {
      if (!isEnboxRecordStore(source)) continue;
      if (client !== undefined && source.client !== client) throw new TypeError('Registered record stores must use the surrounding EnboxProvider client.');
      const previous = result.get(source.definition);
      if (previous !== undefined && previous !== source) throw new TypeError('A record definition must have one shared owner.');
      result.set(source.definition, source);
    }
    for (const source of Object.values(records)) {
      if (!isRecordDefinition(source) && !isEnboxRecordStore(source)) throw new TypeError('Record sources must be definitions or typed record stores.');
      if (!isRecordDefinition(source) || result.has(source)) continue;
      if (client === undefined) throw new Error('Record definitions require an EnboxProvider.');
      result.set(source, new EnboxRecordOwner(source, { client, binding, retainWithoutSubscribers: false }));
    }
    return new Map([...(parentOwners ?? []), ...result]);
  }, [records, client, binding, parentOwners]);
  return <RecordOwners.Provider value={owners}>{children}</RecordOwners.Provider>;
}

export function useRegisteredRecordStore(definition: AnyRecordDefinition | undefined): AnyEnboxRecordStore | undefined {
  const owners = useContext(RecordOwners);
  const client = useOptionalEnboxClient();
  if (definition === undefined) return undefined;
  const owner = owners?.get(definition);
  if (owner === undefined) throw new Error('Register the record definition in an EnboxRecordsProvider before using it.');
  if (client !== undefined && owner.client !== client) throw new TypeError('Record definitions cannot cross EnboxProvider client boundaries.');
  return owner;
}
