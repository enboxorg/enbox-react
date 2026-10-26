'use client';

import type { TypedProtocol } from '@enbox/browser';
import type { AnyEnboxRecordStore, RecordKind } from '../config/record-types.js';
import type { LocalRecordSelection } from '../internal/record-commands.js';

import { useMemo } from 'react';

import { sameConnectionBinding, selectConnectionBinding } from '../internal/connection-binding.js';
import { copyRecordOptions, recordTargetKey } from '../internal/record-commands.js';
import { EnboxRecordOwner, isEnboxRecordStore } from '../internal/enbox-record-store.js';
import { serializeQuery } from '../internal/serialize-query.js';
import { useConnectionStore } from './connection.js';
import { useOptionalEnboxClient } from '../provider.js';

/** Parameterized hooks own their views; supplied stores remain caller-owned. */
export function useRecordOwner(source: unknown, path: string | undefined, value: object | null | undefined, kind: RecordKind): AnyEnboxRecordStore {
  const supplied = isEnboxRecordStore(source) ? source : undefined;
  const providerClient = useOptionalEnboxClient();
  const client = supplied?.client ?? providerClient;
  if (client === undefined) throw new Error('Enbox hooks require an EnboxProvider.');
  const binding = useConnectionStore(client, selectConnectionBinding, sameConnectionBinding);
  const protocol = source as TypedProtocol;
  const recordPath = path;
  if (supplied === undefined && recordPath === undefined) throw new TypeError('A record selection requires a protocol path.');
  const selection = copyRecordOptions(value === undefined ? {} : value) as LocalRecordSelection | null;
  const queryKey = serializeQuery(selection);
  const targetKey = recordTargetKey(kind, selection);
  // Query-only reconfiguration keeps mutation presentation identity.
  const commandScope = useMemo(() => Object.freeze({}), [supplied, client, binding, protocol, recordPath, kind, targetKey]);
  return useMemo(() => supplied ?? new EnboxRecordOwner(
    { protocol, path: recordPath!, kind },
    { client, binding, selection: JSON.parse(queryKey) as object | null, commandScope, retainWithoutSubscribers: false },
  ), [supplied, protocol, recordPath, kind, queryKey, client, binding, commandScope]);
}
