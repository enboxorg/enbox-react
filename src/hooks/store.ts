'use client';

import { useCallback } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

/**
 * React's read/subscription boundary for an observable store, resource, or command.
 * A snapshot is a published state value; reading it does not create a copy.
 */
export type StoreSource<Snapshot> = Readonly<{
  /** Read the same cached value until the source publishes a change. */
  getSnapshot(): Snapshot;
  /** Read the deterministic value shared by server rendering and initial hydration. */
  getServerSnapshot(): Snapshot;
  /** Listen for publications and return the function that removes this listener. */
  subscribe(notify: () => void): () => void;
  /** Keep a resource active until the returned release function runs. */
  retain?(): () => void;
}>;

/**
 * Read a snapshot or selected value while borrowing the source's lifetime.
 * Subscriptions and optional leases start after commit and release on cleanup;
 * rendering only reads cached values. Selectors receive live and server
 * snapshots, and selected values are compared with Object.is unless isEqual is
 * supplied. The application owner remains responsible for runtime disposal.
 */
export function useStore<Snapshot>(store: StoreSource<Snapshot>): Snapshot;
export function useStore<Snapshot, Selection>(
  store: StoreSource<Snapshot>,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (previous: Selection, next: Selection) => boolean,
): Selection;
export function useStore<Snapshot, Selection = Snapshot>(
  store: StoreSource<Snapshot>,
  selector?: (snapshot: Snapshot) => Selection,
  isEqual: (previous: Selection, next: Selection) => boolean = Object.is,
): Selection {
  const subscribe = useCallback((notify: () => void) => {
    const release = store.retain?.();
    try {
      const unsubscribe = store.subscribe(notify);
      return () => {
        try { unsubscribe(); }
        finally { release?.(); }
      };
    } catch (cause) {
      release?.();
      throw cause;
    }
  }, [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const getServerSnapshot = useCallback(() => store.getServerSnapshot(), [store]);
  const select = useCallback((snapshot: Snapshot): Selection =>
    selector === undefined ? snapshot as unknown as Selection : selector(snapshot), [selector]);
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getServerSnapshot, select, isEqual);
}
