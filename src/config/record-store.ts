import type { RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';
import type { SelectedRecordStoreConfig, SelectedRecordStore } from '../internal/selected-record-store.js';
import { SelectedRecords } from '../internal/selected-record-store.js';

export type { SelectedRecordStoreConfig, SelectedRecordStore, SelectedRecordSnapshot } from '../internal/selected-record-store.js';

/** One owned view shared by React consumers and application controllers. */
export type RecordStore<Item> = Readonly<{
  getSnapshot(): RecordViewResult<Item>;
  getServerSnapshot(): RecordViewResult<Item>;
  subscribe(notify: () => void): () => void;
  /** Wait for usable local rows without waiting for replication currentness. */
  ready(options?: { signal?: AbortSignal }): Promise<Extract<RecordViewResult<Item>, { status: 'ready' }>>;
  /** Start or reopen the view; resolves after attachment rather than row readiness. */
  retry(): Promise<void>;
  /** Expand the retained prefix; concurrent calls share the same Promise. */
  loadMore(): Promise<void>;
  /** Close permanently and wait for views already acquired to finish closing. */
  close(): Promise<void>;
}>;

export type RecordStoreOptions = {
  /** Owner lifetime; abort releases the view and invalidates retained controls. */
  signal?: AbortSignal;
  /** Expand the retained selection until the native view has no further page. */
  loadAll?: boolean;
};

/** Subscription, ready(), or retry() opens the view until close() or abort. */
export function createRecordStore<Item>(
  opener: RecordViewOpener<Item> | null,
  options?: RecordStoreOptions,
): RecordStore<Item>;
/**
 * Own native views from an arbitrary selection and opener; select() and retry() can open the view.
 * Protocol-store parent selection uses family.createSelection() to borrow canonical collection handles.
 */
export function createRecordStore<Item, Selection>(
  config: SelectedRecordStoreConfig<Item, Selection>,
): SelectedRecordStore<Item, Selection>;
export function createRecordStore<Item, Selection>(
  opener: RecordViewOpener<Item> | null | SelectedRecordStoreConfig<Item, Selection>,
  options: RecordStoreOptions = {},
): RecordStore<Item> | SelectedRecordStore<Item, Selection> {
  if (opener !== null && typeof opener === 'object') return new SelectedRecords(opener);
  return new RecordViewObserver(opener, {
    ownerSignal: options.signal,
    retainWithoutSubscribers: true,
    loadAll: options.loadAll === true,
  });
}

export function isRecordStore<Item>(value: unknown): value is RecordStore<Item> {
  return value !== null && typeof value === 'object'
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'getServerSnapshot' in value && typeof value.getServerSnapshot === 'function';
}
