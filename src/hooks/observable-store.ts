'use client';

import type { ObservableStore } from '@enbox/browser';

import { useCallback, useSyncExternalStore } from 'react';

const noop = (): void => {};

/** Borrows a synchronous store and a reference-stable immutable fallback. */
export function useObservableStore<Snapshot>(
  store: ObservableStore<Snapshot> | null | undefined,
  fallback: Snapshot,
): Snapshot {
  const subscribe = useCallback((notify: () => void) => store?.subscribe(notify) ?? noop, [store]);
  const getSnapshot = useCallback(() => store == null ? fallback : store.getSnapshot(), [store, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
