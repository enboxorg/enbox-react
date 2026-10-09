'use client';

import { useMemo, useSyncExternalStore } from 'react';

import type {
  BindingGuard,
  RecordViewOpener,
  RecordViewResult,
} from '../internal/record-view-observer.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';

export type { IdleRecordViewState, RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';

export function useRecordViewBinding<Item>(
  opener: RecordViewOpener<Item> | null,
  bindingGuard?: BindingGuard,
): { observer: RecordViewObserver<Item>; snapshot: RecordViewResult<Item> } {
  const observer = useMemo(
    () => new RecordViewObserver(opener, bindingGuard),
    [opener, bindingGuard],
  );
  const snapshot = useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getServerSnapshot);
  return { observer, snapshot };
}

/** Owns a view opened by a memoized callback; null releases the view. */
export function useRecordView<Item>(opener: RecordViewOpener<Item> | null): RecordViewResult<Item> {
  return useRecordViewBinding(opener).snapshot;
}
