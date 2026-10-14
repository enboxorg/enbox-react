import type { RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';
import {
  SelectedRecords, type SelectedRecordStoreConfig, type SelectedRecordStore,
} from '../internal/selected-record-store.js';

export type { SelectedRecordStoreConfig, SelectedRecordStore, SelectedRecordSnapshot } from '../internal/selected-record-store.js';

/** One owned view shared by React consumers and application controllers. */
export type RecordStore<Item> = Readonly<{
  getSnapshot(): RecordViewResult<Item>;
  getServerSnapshot(): RecordViewResult<Item>;
  subscribe(notify: () => void): () => void;
  ready(options?: { signal?: AbortSignal }): Promise<Extract<RecordViewResult<Item>, { status: 'ready' }>>;
  retry(): Promise<void>;
  loadMore(): Promise<void>;
  close(): Promise<void>;
}>;

export type RecordStoreOptions = {
  signal?: AbortSignal;
  /** Expand the retained selection until the native view has no further page. */
  loadAll?: boolean;
};

/** Inert until observed; keeps its view until close() or the owner signal aborts. */
export function createRecordStore<Item>(
  opener: RecordViewOpener<Item> | null,
  options?: RecordStoreOptions,
): RecordStore<Item>;
export function createRecordStore<Item, Selection>(
  config: SelectedRecordStoreConfig<Item, Selection>,
): SelectedRecordStore<Item, Selection>;
export function createRecordStore<Item, Selection>(
  opener: RecordViewOpener<Item> | null | SelectedRecordStoreConfig<Item, Selection>,
  options: RecordStoreOptions = {},
): RecordStore<Item> | SelectedRecordStore<Item, Selection> {
  if (opener !== null && typeof opener === 'object') return new SelectedRecords(opener);
  const signal = options.signal;
  return new RecordViewObserver(opener, signal === undefined ? undefined : {
    isCurrent: () => !signal.aborted,
    subscribe: (notify) => {
      signal.addEventListener('abort', notify, { once: true });
      return () => signal.removeEventListener('abort', notify);
    },
  }, true, options.loadAll === true);
}

export function isRecordStore<Item>(value: unknown): value is RecordStore<Item> {
  return value !== null && typeof value === 'object'
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'getServerSnapshot' in value && typeof value.getServerSnapshot === 'function';
}
