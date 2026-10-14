import type { ContextView, ContextViewState } from '@enbox/browser';

import { OwnedViewObserver, type BindingGuard } from './owned-view-observer.js';

export type ContextViewOpener<Context> = (signal: AbortSignal) => Promise<ContextView<Context>>;

export type IdleContextViewState<Context> = Readonly<{
  status: 'idle';
  contexts: readonly Context[];
  error?: never;
}>;

export type ContextViewResult<Context> = (ContextViewState<Context> | IdleContextViewState<Context>) & Readonly<{
  /** Reopens the catalog. Opening failures reject and are published in state. */
  retry: () => Promise<void>;
}>;

const EMPTY_CONTEXTS = Object.freeze([]);
const IDLE = Object.freeze({ status: 'idle' as const, contexts: EMPTY_CONTEXTS });
const LOADING = Object.freeze({ status: 'loading' as const, contexts: EMPTY_CONTEXTS });

/** Native context state using the same ownership lifecycle as record views. */
export class ContextViewObserver<Context> extends OwnedViewObserver<
  ContextViewState<Context>, IdleContextViewState<Context>, ContextViewResult<Context>, ContextView<Context>
> {
  public constructor(opener: ContextViewOpener<Context> | null, bindingGuard?: BindingGuard, keepAlive = false) {
    super(opener, {
      idle: IDLE,
      loading: LOADING,
      error: (error) => ({ status: 'error', contexts: EMPTY_CONTEXTS, error }),
      result: (state, retry) => Object.freeze({ ...state, retry }),
    }, bindingGuard, keepAlive);
  }
}
