import type { ExpandableRecordView, RecordView, RecordViewState } from '@enbox/browser';

import { EnboxBindingChangedError } from '../errors.js';
import { toError } from './errors.js';
import type { CloseableView, OwnedViewOptions, ViewAttempt } from './owned-view-observer.js';
import { OwnedViewObserver } from './owned-view-observer.js';

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
  /** Reopens an active selection; attachment does not wait for local readiness. */
  retry: () => Promise<void>;
  isLoadingMore: boolean;
}>;

type RecordViewObserverOptions = OwnedViewOptions & Readonly<{ loadAll?: boolean }>;

const EMPTY_RECORDS = Object.freeze([]);
const IDLE = Object.freeze({
  status: 'idle' as const, records: EMPTY_RECORDS, hasMore: false as const, current: false as const,
});
const LOADING = Object.freeze({
  status: 'loading' as const, records: EMPTY_RECORDS, hasMore: false, current: false as const,
});

/** Native record state with owned-view lifecycle and record-only pagination. */
export class RecordViewObserver<Item> extends OwnedViewObserver<
  RecordViewState<Item>, IdleRecordViewState<Item>, RecordViewResult<Item>
> {
  private readonly _pagination: WeakMap<ViewAttempt<RecordViewState<Item>>, Promise<void>>;
  private readonly _expanding = new WeakSet<ViewAttempt<RecordViewState<Item>>>();
  private readonly _loadAll: boolean;

  public constructor(opener: RecordViewOpener<Item> | null, options: RecordViewObserverOptions = {}) {
    const pagination = new WeakMap<ViewAttempt<RecordViewState<Item>>, Promise<void>>();
    super(opener, {
      idle: IDLE,
      loading: LOADING,
      createErrorState: (error) => ({ status: 'error', records: EMPTY_RECORDS, hasMore: false, current: false, error }),
      createSnapshot: (state, retry, attempt) => Object.freeze({
        ...state, retry, isLoadingMore: attempt !== undefined && pagination.has(attempt),
      }),
      sameControls: (previous, next) => previous.isLoadingMore === next.isLoadingMore,
    }, options);
    this._pagination = pagination;
    this._loadAll = options.loadAll ?? false;
  }

  /** A display-only update; the next native publication replaces it. */
  public readonly updateRecords = (update: (records: readonly Item[]) => readonly Item[]): void => {
    const attempt = this._attempt;
    if (this.getSnapshot().status === 'idle') throw new EnboxBindingChangedError();
    const state = this._state;
    const records = update(state.records);
    // An application updater can synchronously replace the selection.
    if (this.getSnapshot().status === 'idle' || this._attempt !== attempt || this._state !== state) {
      throw new EnboxBindingChangedError();
    }
    if (records !== state.records) this.publish({ ...state, records: Object.freeze([...records]) });
  };

  protected override publish(state: RecordViewState<Item> | IdleRecordViewState<Item>): void {
    super.publish(state);
    const attempt = this._attempt;
    if (!this._loadAll || attempt === undefined || !this.isCurrent(attempt)
      || this._state.status !== 'ready' || !this._state.hasMore || this._expanding.has(attempt)) return;
    this._expanding.add(attempt);
    void Promise.resolve().then(async () => {
      while (this.isCurrent(attempt) && this._state.status === 'ready' && this._state.hasMore) {
        await this.loadMore();
      }
    }).catch((cause: unknown) => {
      if (this.isCurrent(attempt) && this._state.status !== 'error') {
        this.publish({ status: 'error', records: this._state.records,
          hasMore: this._state.hasMore, current: false, error: toError(cause) });
      }
    }).finally(() => {
      this._expanding.delete(attempt);
      if (this.isCurrent(attempt) && this._state.status === 'ready' && this._state.hasMore) {
        this.publish(this._state);
      }
    });
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
          status: 'error', records: this._state.records, hasMore: this._state.hasMore,
          current: false, error: toError(cause),
        });
      }
      throw cause;
    }).finally(() => {
      if (this.isCurrent(attempt)) {
        this._pagination.delete(attempt);
        this.publish(this._state);
      }
    });
    this._pagination.set(attempt, pagination);
    // Publish only after storing the Promise so reentrant callers join it.
    this.publish(this._state);
    return pagination;
  };

  private isExpandable(
    view: CloseableView<RecordViewState<Item>>,
  ): view is CloseableView<RecordViewState<Item>> & Pick<ExpandableRecordView<Item>, 'loadMore'> {
    return 'loadMore' in view && typeof view.loadMore === 'function';
  }
}
