import type { ContextViewOpener, ContextViewResult } from '../internal/context-view-observer.js';
import { ContextViewObserver } from '../internal/context-view-observer.js';

/** One context catalog shared by React consumers and application controllers. */
export type ContextStore<Context> = Readonly<{
  getSnapshot(): ContextViewResult<Context>;
  getServerSnapshot(): ContextViewResult<Context>;
  subscribe(notify: () => void): () => void;
  ready(options?: { signal?: AbortSignal }): Promise<Extract<ContextViewResult<Context>, { status: 'ready' }>>;
  retry(): Promise<void>;
  close(): Promise<void>;
}>;

export type ContextStoreOptions = { signal?: AbortSignal };

/** Inert until observed; keeps its catalog until close() or the owner signal aborts. */
export function createContextStore<Context>(
  opener: ContextViewOpener<Context> | null,
  options: ContextStoreOptions = {},
): ContextStore<Context> {
  const signal = options.signal;
  return new ContextViewObserver(opener, signal === undefined ? undefined : {
    isCurrent: () => !signal.aborted,
    subscribe: (notify) => {
      signal.addEventListener('abort', notify, { once: true });
      return () => signal.removeEventListener('abort', notify);
    },
  }, true);
}

export function isContextStore<Context>(value: unknown): value is ContextStore<Context> {
  return value !== null && typeof value === 'object'
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'getServerSnapshot' in value && typeof value.getServerSnapshot === 'function';
}
