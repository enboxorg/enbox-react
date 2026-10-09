'use client';

import { useMemo, useSyncExternalStore } from 'react';

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
  const observer = useMemo(
    () => isRecordStore<Item>(opener) ? opener : new RecordViewObserver(opener, bindingGuard),
    [opener, bindingGuard],
  );
  const snapshot = useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getServerSnapshot);
  return { observer, snapshot };
}

/** Owns a view opened by a memoized callback; null releases the view. */
export function useRecordView<Item>(opener: RecordViewOpener<Item> | RecordStore<Item> | null): RecordViewResult<Item> {
  return useRecordViewBinding(opener).snapshot;
}
