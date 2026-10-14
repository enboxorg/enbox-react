import type { ExpandableRecordView, RecordView, RecordViewState } from '@enbox/browser';

import { EnboxBindingChangedError } from '../errors.js';
import { toError } from './errors.js';
import { OwnedViewObserver, type BindingGuard, type ViewAttempt } from './owned-view-observer.js';

export type { BindingGuard } from './owned-view-observer.js';
export type RecordViewOpener<Item> = (signal: AbortSignal) => Promise<RecordView<Item>>;

export type IdleRecordViewState<Item> = Readonly<{
  status: 'idle';
  records: readonly Item[];
  hasMore: false;
  current: false;
  error?: never;
}>;

export type RecordViewResult<Item> = (RecordViewState<Item> | IdleRecordViewState<Item>) & Readonly<{
  /** Reopens the selection. Opening failures reject and are published in state. */
  retry: () => Promise<void>;
  isLoadingMore: boolean;
}>;

const EMPTY_RECORDS = Object.freeze([]);
const IDLE = Object.freeze({
  status: 'idle' as const, records: EMPTY_RECORDS, hasMore: false as const, current: false as const,
});
const LOADING = Object.freeze({
  status: 'loading' as const, records: EMPTY_RECORDS, hasMore: false, current: false as const,
});

/** Native record state with owned-view lifecycle and record-only pagination. */
export class RecordViewObserver<Item> extends OwnedViewObserver<
  RecordViewState<Item>, IdleRecordViewState<Item>, RecordViewResult<Item>, RecordView<Item>
> {
  private readonly _pagination: WeakMap<ViewAttempt<RecordView<Item>>, Promise<void>>;

  public constructor(opener: RecordViewOpener<Item> | null, bindingGuard?: BindingGuard, keepAlive = false) {
    const pagination = new WeakMap<ViewAttempt<RecordView<Item>>, Promise<void>>();
    super(opener, {
      idle: IDLE,
      loading: LOADING,
      error: (error) => ({ status: 'error', records: EMPTY_RECORDS, hasMore: false, current: false, error }),
      result: (state, retry, attempt) => Object.freeze({
        ...state, retry, isLoadingMore: attempt !== undefined && pagination.has(attempt),
      }),
      sameResult: (previous, next) => previous.isLoadingMore === next.isLoadingMore,
    }, bindingGuard, keepAlive);
    this._pagination = pagination;
  }

  public readonly loadMore = (): Promise<void> => {
    const attempt = this._attempt;
    if (attempt === undefined || !this.isCurrent(attempt) || attempt.view === undefined) {
      return Promise.reject(new EnboxBindingChangedError());
    }
    const view = attempt.view;
    if (!this.isExpandable(view)) {
      return Promise.reject(new TypeError('This record view does not support loadMore().'));
    }
    const existing = this._pagination.get(attempt);
    if (existing !== undefined) return existing;
    const pagination = Promise.resolve().then(async () => {
      if (!this.isCurrent(attempt)) throw new EnboxBindingChangedError();
      await view.loadMore();
    }).catch((cause: unknown) => {
      if (this.isCurrent(attempt)) {
        this.publish({
          status: 'error', records: this._viewState.records, hasMore: this._viewState.hasMore,
          current: false, error: toError(cause),
        });
      }
      throw cause;
    }).finally(() => {
      if (this.isCurrent(attempt)) {
        this._pagination.delete(attempt);
        this.publish(this._viewState);
      }
    });
    this._pagination.set(attempt, pagination);
    this.publish(this._viewState);
    return pagination;
  };

  private isExpandable(view: RecordView<Item>): view is ExpandableRecordView<Item> {
    return 'loadMore' in view && typeof view.loadMore === 'function';
  }
}
