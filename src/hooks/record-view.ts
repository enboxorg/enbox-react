'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type {
  BindingGuard,
  RecordViewOpener,
  RecordViewResult,
} from '../internal/record-view-observer.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';
import { isRecordStore, type RecordStore } from '../config/record-store.js';

export type { IdleRecordViewState, RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';

export function useRecordViewBinding<Item>(
  opener: RecordViewOpener<Item> | RecordStore<Item> | null,
  bindingGuard?: BindingGuard,
): { observer: RecordStore<Item>; snapshot: RecordViewResult<Item> } {
  const borrowed = isRecordStore<Item>(opener);
  const observer = useMemo(
    () => borrowed ? opener : new RecordViewObserver(opener, bindingGuard),
    [opener, bindingGuard, borrowed],
  );
  const subscribe = useCallback((notify: () => void) => observer.subscribe(notify), [observer]);
  const getSnapshot = useCallback(() => observer.getSnapshot(), [observer]);
  const getServerSnapshot = useCallback(() => observer.getServerSnapshot(), [observer]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const retry = useCallback(() => observer.retry(), [observer]);
  const snapshot = useMemo(() => borrowed ? state : Object.freeze({ ...state, retry }), [state, retry, borrowed]);
  return { observer, snapshot };
}

/** Owns a view opened by a memoized callback; null releases the view. */
export function useRecordView<Store extends RecordStore<unknown>>(store: Store): ReturnType<Store['getSnapshot']>;
export function useRecordView<Item>(opener: RecordViewOpener<Item> | RecordStore<Item> | null): RecordViewResult<Item>;
export function useRecordView<Item>(opener: RecordViewOpener<Item> | RecordStore<Item> | null): RecordViewResult<Item> {
  return useRecordViewBinding(opener).snapshot;
}
