import type { RecordViewOpener, RecordViewResult } from '../internal/record-view-observer.js';
import { RecordViewObserver } from '../internal/record-view-observer.js';

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

export type RecordStoreOptions = { signal?: AbortSignal };

/** Inert until observed; keeps its view until close() or the owner signal aborts. */
export function createRecordStore<Item>(
  opener: RecordViewOpener<Item> | null,
  options: RecordStoreOptions = {},
): RecordStore<Item> {
  const signal = options.signal;
  return new RecordViewObserver(opener, signal === undefined ? undefined : {
    isCurrent: () => !signal.aborted,
    subscribe: (notify) => {
      signal.addEventListener('abort', notify, { once: true });
      return () => signal.removeEventListener('abort', notify);
    },
  }, true);
}

export function isRecordStore<Item>(value: unknown): value is RecordStore<Item> {
  return value !== null && typeof value === 'object'
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'getServerSnapshot' in value && typeof value.getServerSnapshot === 'function';
}
