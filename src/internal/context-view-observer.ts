import type { ContextView, ContextViewState } from '@enbox/browser';

import type { OwnedViewOptions } from './owned-view-observer.js';
import { OwnedViewObserver } from './owned-view-observer.js';

export type ContextViewOpener<Context> = (signal: AbortSignal) => Promise<ContextView<Context>>;

export type IdleContextViewState<Context> = Readonly<{
  status: 'idle';
  contexts: readonly Context[];
  error?: never;
}>;

export type ContextViewResult<Context> = (ContextViewState<Context> | IdleContextViewState<Context>) & Readonly<{
  /** Reopens an active catalog; resolves after its native subscription attaches. */
  retry: () => Promise<void>;
}>;

const EMPTY_CONTEXTS = Object.freeze([]);
const IDLE = Object.freeze({ status: 'idle' as const, contexts: EMPTY_CONTEXTS });
const LOADING = Object.freeze({ status: 'loading' as const, contexts: EMPTY_CONTEXTS });

/** Native context state using the same ownership lifecycle as record views. */
export class ContextViewObserver<Context> extends OwnedViewObserver<
  ContextViewState<Context>, IdleContextViewState<Context>, ContextViewResult<Context>
> {
  public constructor(opener: ContextViewOpener<Context> | null, options: OwnedViewOptions = {}) {
    super(opener, {
      idle: IDLE,
      loading: LOADING,
      createErrorState: (error) => ({ status: 'error', contexts: EMPTY_CONTEXTS, error }),
      createSnapshot: (state, retry) => Object.freeze({ ...state, retry }),
    }, options);
  }
}
