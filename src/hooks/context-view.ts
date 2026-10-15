'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { BindingGuard } from '../internal/owned-view-observer.js';
import type { ContextViewOpener, ContextViewResult } from '../internal/context-view-observer.js';
import { ContextViewObserver } from '../internal/context-view-observer.js';
import { isContextStore, type ContextStore } from '../config/context-store.js';

export type { ContextViewOpener, ContextViewResult, IdleContextViewState } from '../internal/context-view-observer.js';

export function useContextViewBinding<Context>(
  opener: ContextViewOpener<Context> | ContextStore<Context> | null,
  bindingGuard?: BindingGuard,
): { observer: ContextStore<Context>; snapshot: ContextViewResult<Context> } {
  const observer = useMemo(
    () => isContextStore<Context>(opener) ? opener : new ContextViewObserver(opener, { bindingGuard }),
    [opener, bindingGuard],
  );
  // Supplied stores can use ordinary methods that require their receiver.
  const subscribe = useCallback((notify: () => void) => observer.subscribe(notify), [observer]);
  const getSnapshot = useCallback(() => observer.getSnapshot(), [observer]);
  const getServerSnapshot = useCallback(() => observer.getServerSnapshot(), [observer]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const retry = useCallback(() => observer.retry(), [observer]);
  const snapshot = useMemo(() => Object.freeze({ ...state, retry }), [state, retry]);
  return { observer, snapshot };
}

/** Own a catalog from a memoized opener, borrow a supplied store, or disable with null. */
export function useContextView<Context>(
  opener: ContextViewOpener<Context> | ContextStore<Context> | null,
): ContextViewResult<Context> {
  return useContextViewBinding(opener).snapshot;
}
