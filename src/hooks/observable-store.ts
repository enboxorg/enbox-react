'use client';

import { useCallback, useSyncExternalStore } from 'react';

const noop = (): void => {};

/** A cached snapshot with change notifications; payloads are not required. */
export type ObservableStoreSource<Snapshot> = Readonly<{
  getSnapshot(): Snapshot;
  subscribe(notify: () => void): () => void;
}>;

/** Borrows a synchronous store and a reference-stable immutable fallback. */
export function useObservableStore<Snapshot>(
  store: ObservableStoreSource<Snapshot> | null | undefined,
  fallback: Snapshot,
): Snapshot {
  const subscribe = useCallback((notify: () => void) => store?.subscribe(notify) ?? noop, [store]);
  const getSnapshot = useCallback(() => store == null ? fallback : store.getSnapshot(), [store, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
