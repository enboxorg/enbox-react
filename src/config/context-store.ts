import type { ContextViewOpener, ContextViewResult } from '../internal/context-view-observer.js';
import { ContextViewObserver } from '../internal/context-view-observer.js';

/** One context catalog shared by React consumers and application controllers. */
export type ContextStore<Context> = Readonly<{
  getSnapshot(): ContextViewResult<Context>;
  getServerSnapshot(): ContextViewResult<Context>;
  subscribe(notify: () => void): () => void;
  /** Wait for usable contexts; cancelling this wait does not retire the catalog. */
  ready(options?: { signal?: AbortSignal }): Promise<Extract<ContextViewResult<Context>, { status: 'ready' }>>;
  /** Reopen an active catalog; resolves when its native view attaches. */
  retry(): Promise<void>;
  /** Close permanently and wait for views already acquired to finish closing. */
  close(): Promise<void>;
}>;

export type ContextStoreOptions = {
  /** Owner lifetime; abort releases the view and invalidates retained controls. */
  signal?: AbortSignal;
};

/** Subscription or ready() opens the catalog; it stays open until close() or abort. */
export function createContextStore<Context>(
  opener: ContextViewOpener<Context> | null,
  options: ContextStoreOptions = {},
): ContextStore<Context> {
  const signal = options.signal;
  const bindingGuard = signal === undefined ? undefined : {
    isCurrent: () => !signal.aborted,
    subscribe: (notify: () => void) => {
      signal.addEventListener('abort', notify, { once: true });
      return () => signal.removeEventListener('abort', notify);
    },
  };
  return new ContextViewObserver(opener, { bindingGuard, retainWithoutSubscribers: true });
}

export function isContextStore<Context>(value: unknown): value is ContextStore<Context> {
  return value !== null && typeof value === 'object'
    && 'getSnapshot' in value && typeof value.getSnapshot === 'function'
    && 'getServerSnapshot' in value && typeof value.getServerSnapshot === 'function';
}
