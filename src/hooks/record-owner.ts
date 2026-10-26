'use client';

import type { TypedProtocol } from '@enbox/browser';
import type { AnyEnboxRecordStore, RecordKind } from '../config/record-definition.js';
import type { LocalRecordSelection } from '../internal/record-commands.js';

import { useMemo } from 'react';

import { copyRecordOptions, createRecordDefinition, isRecordDefinition } from '../config/record-definition.js';
import { sameConnectionBinding, selectConnectionBinding } from '../internal/connection-binding.js';
import { recordTargetKey } from '../internal/record-commands.js';
import { EnboxRecordOwner, isEnboxRecordStore } from '../internal/enbox-record-store.js';
import { serializeQuery } from '../internal/serialize-query.js';
import { useConnectionStore } from './connection.js';
import { useOptionalEnboxClient } from '../internal/provider-context.js';
import { useRegisteredRecordStore } from '../records-provider.js';

/** One resolver for explicit owners, registered definitions, and the shorthand API. */
export function useRecordOwner(source: unknown, path: string | undefined, value: object | null | undefined, kind: RecordKind): AnyEnboxRecordStore {
  const definition = isRecordDefinition(source) ? source : undefined;
  const registered = useRegisteredRecordStore(definition);
  const supplied = isEnboxRecordStore(source) ? source : registered;
  const providerClient = useOptionalEnboxClient();
  const client = supplied?.client ?? providerClient;
  if (client === undefined) throw new Error('Enbox hooks require an EnboxProvider.');
  const binding = useConnectionStore(client, selectConnectionBinding, sameConnectionBinding);
  const protocol = supplied?.definition.protocol ?? source as TypedProtocol;
  const recordPath = supplied?.definition.path ?? path;
  if (recordPath === undefined) throw new TypeError('A record selection requires a protocol path.');
  const selection = copyRecordOptions(value === undefined ? {} : value) as LocalRecordSelection | null;
  const queryKey = serializeQuery(selection);
  const targetKey = recordTargetKey(kind, selection);
  // Query-only reconfiguration keeps mutation presentation identity.
  const commandScope = useMemo(() => Object.freeze({}), [supplied, client, binding, protocol, recordPath, kind, targetKey]);
  return useMemo(() => supplied ?? new EnboxRecordOwner(
    createRecordDefinition({ protocol, path: recordPath, kind, options: JSON.parse(queryKey) as object | null }),
    { client, binding, commandScope, retainWithoutSubscribers: false },
  ), [supplied, protocol, recordPath, kind, queryKey, client, binding, commandScope]);
}
