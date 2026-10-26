'use client';

import { useCallback } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

/** Observable resources and commands provide snapshots; retention starts committed work. */
export type StoreSource<Snapshot> = Readonly<{
  getSnapshot(): Snapshot;
  getServerSnapshot(): Snapshot;
  subscribe(notify: () => void): () => void;
  retain?(): () => void;
}>;

/** Subscribe to an application store, resource, or command without owning its runtime. */
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
