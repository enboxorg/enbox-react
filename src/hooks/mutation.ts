'use client';

import type { ConnectionStore, Enbox } from '@enbox/browser';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { EnboxMutationSnapshot } from '../internal/mutation-observer.js';
import { EnboxMutationObserver } from '../internal/mutation-observer.js';
import { sameConnectionBinding, selectConnectionBinding } from '../internal/connection-binding.js';
import { useConnectionStore } from './connection.js';
import { useEnboxClient } from '../provider.js';

export type EnboxMutation<Variables, Result> = (enbox: Enbox, variables: Variables) => Promise<Result>;
export type EnboxMutationOptions = Readonly<{
  /** Changing this owner resets presentation without cancelling issued writes. */
  scope?: unknown;
}>;
export type EnboxMutationResult<Variables, Result> = EnboxMutationSnapshot<Variables> & Readonly<{
  /** Compatibility alias for mutateAsync. */
  run: (variables: Variables) => Promise<Result>;
  /** Event-handler action; failures remain visible in error. */
  mutate: (variables: Variables) => void;
  /** Await the native result; failures reject with their original cause. */
  mutateAsync: (variables: Variables) => Promise<Result>;
  /** Clear the displayed error without cancelling writes or clearing pending work. */
  reset: () => void;
  /** Check before caller UI effects after an issued write finishes. */
  isCurrent: () => boolean;
}>;

/** Run session-bound mutations with scoped progress and error presentation. */
export function useEnboxMutation<Variables = void, Result = unknown>(
  operation: EnboxMutation<Variables, Result>,
  options: EnboxMutationOptions = {},
): EnboxMutationResult<Variables, Result> {
  const client = useEnboxClient();
  return useClientMutation(client, operation, options);
}

/** The same mutation presentation for provider calls and borrowed record owners. */
export function useClientMutation<Variables = void, Result = unknown>(
  client: ConnectionStore,
  operation: EnboxMutation<Variables, Result>,
  options: EnboxMutationOptions = {},
): EnboxMutationResult<Variables, Result> {
  const binding = useConnectionStore(client, selectConnectionBinding, sameConnectionBinding);
  const observer = useMemo(
    () => new EnboxMutationObserver<Variables>(client, binding),
    [client, binding, options.scope],
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
  const mutate = useCallback((variables: Variables): void => {
    // The observer publishes failures in state; event handlers need no empty catch.
    void run(variables).catch(() => {});
  }, [run]);
  return useMemo(
    () => Object.freeze({ ...snapshot, run, mutate, mutateAsync: run, reset: observer.reset, isCurrent: observer.captureGuard() }),
    [snapshot, run, mutate, observer],
  );
}
