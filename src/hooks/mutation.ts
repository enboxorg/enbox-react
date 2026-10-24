'use client';

import type { Enbox } from '@enbox/browser';

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
export type EnboxMutationCallOptions<Variables, Result> = Readonly<{
  /** Starts only in the invoking lifetime after native success. Awaited; failures enter error state. */
  onSuccess?: (result: Result, variables: Variables) => unknown;
}>;
export type EnboxMutationResult<Variables, Result> = EnboxMutationSnapshot<Variables> & Readonly<{
  /** Compatibility alias for mutateAsync. */
  run: (variables: Variables, options?: EnboxMutationCallOptions<Variables, Result>) => Promise<Result>;
  /** Event-handler action; failures remain visible in error. */
  mutate: (variables: Variables, options?: EnboxMutationCallOptions<Variables, Result>) => void;
  /** Await the operation and optional success handler; failures reject with their original cause. */
  mutateAsync: (variables: Variables, options?: EnboxMutationCallOptions<Variables, Result>) => Promise<Result>;
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
    (variables: Variables, options?: EnboxMutationCallOptions<Variables, Result>): Promise<Result> => {
      const isCurrent = observer.captureGuard();
      return observer.run(async (enbox, input) => {
        const onSuccess = options?.onSuccess;
        if (onSuccess !== undefined && typeof onSuccess !== 'function') {
          throw new TypeError('Enbox mutation onSuccess must be a function.');
        }
        const result = await operation(enbox, input);
        if (onSuccess !== undefined && isCurrent()) await onSuccess(result, input);
        return result;
      }, variables);
    },
    [observer, operation],
  );
  const mutate = useCallback((variables: Variables, options?: EnboxMutationCallOptions<Variables, Result>): void => {
    // run() publishes operation and handler failures; event handlers need no empty catch.
    void run(variables, options).catch(() => {});
  }, [run]);
  return useMemo(
    () => Object.freeze({ ...snapshot, run, mutate, mutateAsync: run, reset: observer.reset, isCurrent: observer.captureGuard() }),
    [snapshot, run, mutate, observer],
  );
}
