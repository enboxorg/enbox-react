'use client';

import { useMemo } from 'react';

import type { ContextViewOpener, ContextViewResult } from '../internal/context-view-observer.js';
import { ContextViewObserver } from '../internal/context-view-observer.js';
import type { ContextStore } from '../config/context-store.js';
import { useObservableStore } from './observable-store.js';

export type { ContextViewOpener, ContextViewResult, IdleContextViewState } from '../internal/context-view-observer.js';

/** Own a catalog from a memoized opener, borrow a supplied store, or disable with null. */
export function useContextView<Store extends ContextStore<unknown>>(store: Store):
  ReturnType<Store['getSnapshot']> | ReturnType<Store['getServerSnapshot']>;
export function useContextView<Context>(
  opener: ContextViewOpener<Context> | ContextStore<Context> | null,
): ContextViewResult<Context>;
export function useContextView<Context>(
  opener: ContextViewOpener<Context> | ContextStore<Context> | null,
): ContextViewResult<Context> {
  const observer = useMemo(
    () => opener === null || typeof opener === 'function' ? new ContextViewObserver(opener) : opener,
    [opener],
  );
  return useObservableStore(observer, observer.getServerSnapshot());
}
