'use client';

import type { Enbox } from '@enbox/browser';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { EnboxMutationSnapshot } from '../internal/mutation-observer.js';
import { EnboxMutationObserver } from '../internal/mutation-observer.js';
import { sameConnectionBinding, selectConnectionBinding } from '../internal/connection-binding.js';
import { useConnection } from './connection.js';
import { useEnboxClient } from '../provider.js';

export type EnboxMutation<Variables, Result> = (enbox: Enbox, variables: Variables) => Promise<Result>;
export type EnboxMutationResult<Variables, Result> = EnboxMutationSnapshot & Readonly<{
  run: (variables: Variables) => Promise<Result>;
  reset: () => void;
}>;

/** Invokes once through the rendered session; never redirects old UI to a new identity. */
export function useEnboxMutation<Variables = void, Result = unknown>(
  operation: EnboxMutation<Variables, Result>,
): EnboxMutationResult<Variables, Result> {
  const client = useEnboxClient();
  const expected = useConnection(selectConnectionBinding, sameConnectionBinding);
  const observer = useMemo(
    () => new EnboxMutationObserver(client, expected),
    [client, expected],
  );
  const snapshot = useSyncExternalStore(
    observer.subscribe,
    observer.getSnapshot,
    observer.getServerSnapshot,
  );
  // The function captures this render's operation. No ref is changed during render.
  const run = useCallback(
    (variables: Variables) => observer.run(operation, variables),
    [observer, operation],
  );
  return useMemo(
    () => Object.freeze({ ...snapshot, run, reset: observer.reset }),
    [snapshot, run, observer],
  );
}
