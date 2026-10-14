'use client';

import { useCallback } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

const noop = (): void => {};
const ABSENT = Symbol('absent observable store');
const getServerSnapshot = (): typeof ABSENT => ABSENT;

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
/** Selects actual snapshots; absent sources and server rendering return the selected fallback. */
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
  const getSnapshot = useCallback(() => store == null ? ABSENT : store.getSnapshot(), [store]);
  const select = useCallback((snapshot: Snapshot | typeof ABSENT): Selection => snapshot === ABSENT
    ? fallback : selector === undefined ? snapshot as unknown as Selection : selector(snapshot), [fallback, selector]);
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getServerSnapshot, select, isEqual);
}
