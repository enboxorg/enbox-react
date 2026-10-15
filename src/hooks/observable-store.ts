'use client';

import { useCallback } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

const noop = (): void => {};
// Undefined may be a real snapshot. A separate sentinel also avoids server reads.
const NO_SNAPSHOT = Symbol('absent observable store');
const getServerSnapshot = (): typeof NO_SNAPSHOT => NO_SNAPSHOT;

/** A cached snapshot with change notifications; payloads are not required. */
export type ObservableStoreSource<Snapshot> = Readonly<{
  getSnapshot(): Snapshot;
  subscribe(notify: () => void): () => void;
}>;

/** Borrows a synchronous store and a reference-stable immutable fallback. */
export function useObservableStore<Snapshot>(
  store: ObservableStoreSource<Snapshot> | null | undefined,
  fallback: Snapshot,
): Snapshot;
/** Absent sources and server rendering return fallback without invoking selector. */
export function useObservableStore<Snapshot, Selection>(
  store: ObservableStoreSource<Snapshot> | null | undefined,
  fallback: NoInfer<Selection>,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (previous: Selection, next: Selection) => boolean,
): Selection;
export function useObservableStore<Snapshot, Selection = Snapshot>(
  store: ObservableStoreSource<Snapshot> | null | undefined,
  fallback: Selection,
  selector?: (snapshot: Snapshot) => Selection,
  isEqual: (previous: Selection, next: Selection) => boolean = Object.is,
): Selection {
  const subscribe = useCallback((notify: () => void) => store?.subscribe(notify) ?? noop, [store]);
  const getSnapshot = useCallback(() => store == null ? NO_SNAPSHOT : store.getSnapshot(), [store]);
  const select = useCallback((snapshot: Snapshot | typeof NO_SNAPSHOT): Selection => {
    if (snapshot === NO_SNAPSHOT) return fallback;
    return selector === undefined ? snapshot as unknown as Selection : selector(snapshot);
  }, [fallback, selector]);
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getServerSnapshot, select, isEqual);
}
