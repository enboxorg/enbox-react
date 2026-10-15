'use client';

import { useMemo } from 'react';

import type {
  BindingGuard,
  RecordViewOpener,
  RecordViewResult,
} from '../internal/record-view-observer.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';
import type { RecordStore } from '../config/record-store.js';
import { useObservableStore } from './observable-store.js';

export type { IdleRecordViewState, RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';

export function useRecordViewBinding<Item>(
  opener: RecordViewOpener<Item> | RecordStore<Item> | null,
  bindingGuard?: BindingGuard,
): { observer: RecordStore<Item>; snapshot: RecordViewResult<Item> } {
  const observer = useMemo(
    () => opener === null || typeof opener === 'function'
      ? new RecordViewObserver(opener, { bindingGuard }) : opener,
    [opener, bindingGuard],
  );
  const snapshot = useObservableStore(observer, observer.getServerSnapshot());
  return { observer, snapshot };
}

/** Own a view from a memoized opener, borrow a supplied store, or disable with null. */
export function useRecordView<Store extends RecordStore<unknown>>(store: Store): ReturnType<Store['getSnapshot']>;
export function useRecordView<Item>(opener: RecordViewOpener<Item> | RecordStore<Item> | null): RecordViewResult<Item>;
export function useRecordView<Item>(opener: RecordViewOpener<Item> | RecordStore<Item> | null): RecordViewResult<Item> {
  return useRecordViewBinding(opener).snapshot;
}
