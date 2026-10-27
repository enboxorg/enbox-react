'use client';

import { useCallback } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

/** A cached observable value read by React after each publication. */
export type StoreSource<Snapshot> = Readonly<{
  getSnapshot(): Snapshot;
  subscribe(notify: () => void): () => void;
}>;

type SelectionOptions<Snapshot, Selection> = Readonly<{
  selector: (snapshot: Snapshot) => Selection;
  isEqual?: (previous: Selection, next: Selection) => boolean;
}>;
type FallbackOptions<Selection> = Readonly<{
  /** Used directly when the source is absent. */
  fallback: NoInfer<Selection>;
}>;

const noop = (): void => {};
// Undefined is a legitimate snapshot; absence must have a separate identity.
const NO_SNAPSHOT = Symbol('absent store snapshot');

/**
 * Subscribe after commit without taking ownership of the source. SDK resources
 * activate through their subscriptions; headless owners can retain them separately.
 * Reads return cached values, and selected values use Object.is unless overridden.
 * Nullable sources require an explicit fallback for absence.
 * Fallbacks are already selected values and never pass through the selector.
 */
export function useStore<Snapshot>(store: StoreSource<Snapshot>): Snapshot;
export function useStore<Snapshot, Selection>(
  store: StoreSource<Snapshot>,
  options: SelectionOptions<Snapshot, Selection>,
): Selection;
export function useStore<Snapshot>(
  store: null | undefined,
  options: Readonly<{ fallback: Snapshot }>,
): Snapshot;
export function useStore<Snapshot>(
  store: StoreSource<Snapshot> | null | undefined,
  options: FallbackOptions<Snapshot>,
): Snapshot;
export function useStore<Snapshot, Selection>(
  store: StoreSource<Snapshot> | null | undefined,
  options: FallbackOptions<Selection> & SelectionOptions<Snapshot, Selection>,
): Selection;
export function useStore<Snapshot, Selection = Snapshot>(
  store: StoreSource<Snapshot> | null | undefined,
  options?: Partial<FallbackOptions<Selection> & SelectionOptions<Snapshot, Selection>>,
): Selection {
  const selector = options?.selector;
  const fallback = options?.fallback;
  const hasFallback = options !== undefined && Object.hasOwn(options, 'fallback');
  const subscribe = useCallback((notify: () => void) => store?.subscribe(notify) ?? noop, [store]);
  const getSnapshot = useCallback((): Snapshot | typeof NO_SNAPSHOT => store == null ? NO_SNAPSHOT : store.getSnapshot(), [store]);
  const select = useCallback((snapshot: Snapshot | typeof NO_SNAPSHOT): Selection => {
    if (snapshot === NO_SNAPSHOT) {
      if (!hasFallback) throw new TypeError('useStore requires a fallback when the source is absent.');
      return fallback as Selection;
    }
    return selector === undefined ? snapshot as unknown as Selection : selector(snapshot);
  }, [fallback, hasFallback, selector]);
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, select, options?.isEqual ?? Object.is);
}
