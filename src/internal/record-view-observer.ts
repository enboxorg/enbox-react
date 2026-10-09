import type { ExpandableRecordView, RecordView, RecordViewState } from '@enbox/browser';

import { EnboxBindingChangedError } from '../errors.js';
import { reportCleanupError, toError } from './errors.js';

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

export type BindingGuard = {
  isCurrent(): boolean;
  subscribe(notify: () => void): () => void;
};

type ViewAttempt<Item> = {
  readonly controller: AbortController;
  readonly opening: Promise<void>;
  view: RecordView<Item> | undefined;
  unsubscribe: (() => void) | undefined;
  pagination: Promise<void> | undefined;
};

const EMPTY_RECORDS = Object.freeze([]);
const IDLE = Object.freeze({
  status: 'idle' as const,
  records: EMPTY_RECORDS,
  hasMore: false as const,
  current: false as const,
});
const LOADING = Object.freeze({
  status: 'loading' as const,
  records: EMPTY_RECORDS,
  hasMore: false,
  current: false as const,
});

/** An inert observer; the first/last subscriber opens/releases its view. */
export class RecordViewObserver<Item> {
  private readonly _listeners = new Set<() => void>();
  private readonly _idle: RecordViewResult<Item>;
  private readonly _loading: RecordViewResult<Item>;
  private _snapshot: RecordViewResult<Item>;
  private _viewState: RecordViewState<Item> | IdleRecordViewState<Item> = IDLE;
  private _active = false;
  private _attempt: ViewAttempt<Item> | undefined;
  private _unsubscribeBinding: (() => void) | undefined;

  public constructor(
    private readonly _opener: RecordViewOpener<Item> | null,
    private readonly _bindingGuard?: BindingGuard,
  ) {
    this._idle = this.result(IDLE, false);
    this._loading = this.result(LOADING, false);
    this._viewState = _opener === null ? IDLE : LOADING;
    this._snapshot = _opener === null ? this._idle : this._loading;
  }

  public readonly getSnapshot = (): RecordViewResult<Item> =>
    this.isBindingCurrent() ? this._snapshot : this._idle;

  public readonly getServerSnapshot = (): RecordViewResult<Item> => this._idle;

  public readonly subscribe = (notify: () => void): (() => void) => {
    const listener = (): void => { notify(); };
    this._listeners.add(listener);
    if (this._listeners.size === 1) this.start();
    return () => {
      if (!this._listeners.delete(listener)) return;
      if (this._listeners.size === 0) this.stop();
    };
  };

  private start(): void {
    this._active = true;
    this._unsubscribeBinding = this._bindingGuard?.subscribe(() => {
      if (!this.isBindingCurrent()) {
        this.closeAttempt();
        this.publish(IDLE, false);
      }
    });
    if (this._opener !== null && this.isBindingCurrent()) {
      // Automatic opening publishes failures; explicit retry callers receive them.
      void this.begin().catch(() => {});
    }
  }

  private stop(): void {
    this._active = false;
    const unsubscribeBinding = this._unsubscribeBinding;
    this._unsubscribeBinding = undefined;
    if (unsubscribeBinding !== undefined) this.unsubscribe(unsubscribeBinding);
    this.closeAttempt();
    this._viewState = this._opener === null ? IDLE : LOADING;
    this._snapshot = this._opener === null ? this._idle : this._loading;
    this.notify();
  }

  public readonly retry = (): Promise<void> => {
    if (!this._active || this._opener === null || !this.isBindingCurrent()) {
      return Promise.reject(new EnboxBindingChangedError());
    }
    if (this._attempt !== undefined && this._attempt.view === undefined) {
      return this._attempt.opening;
    }
    return this.begin();
  };

  public readonly loadMore = (): Promise<void> => {
    const attempt = this._attempt;
    if (attempt === undefined || !this.isCurrent(attempt) || attempt.view === undefined) {
      return Promise.reject(new EnboxBindingChangedError());
    }
    const view = attempt.view;
    if (!this.isExpandable(view)) {
      return Promise.reject(new TypeError('This record view does not support loadMore().'));
    }
    if (attempt.pagination !== undefined) {
      return attempt.pagination;
    }
    const pagination = Promise.resolve().then(async () => {
      if (!this.isCurrent(attempt)) throw new EnboxBindingChangedError();
      await view.loadMore();
    }).catch((cause: unknown) => {
      if (this.isCurrent(attempt)) {
        this.publish({
          status: 'error',
          records: this._viewState.records,
          hasMore: this._viewState.hasMore,
          current: false,
          error: toError(cause),
        }, true);
      }
      throw cause;
    }).finally(() => {
      if (this.isCurrent(attempt)) {
        attempt.pagination = undefined;
        this.publish(this._viewState, false);
      }
    });
    attempt.pagination = pagination;
    // Publish only after the shared operation is available to listeners.
    this.publish(this._viewState, true);
    return pagination;
  };

  private isBindingCurrent(): boolean {
    return this._bindingGuard?.isCurrent() ?? true;
  }

  private isCurrent(attempt: ViewAttempt<Item>): boolean {
    return this._active
      && this._attempt === attempt
      && !attempt.controller.signal.aborted
      && this.isBindingCurrent();
  }

  private begin(): Promise<void> {
    const previous = this._attempt;
    const attempt: ViewAttempt<Item> = {
      controller: new AbortController(),
      opening: Promise.resolve().then(() => this.open(attempt)),
      view: undefined,
      unsubscribe: undefined,
      pagination: undefined,
    };
    // Register the replacement before cleanup can request another retry.
    this._attempt = attempt;
    this.releaseAttempt(previous);
    if (this.isCurrent(attempt)) this.publish(LOADING, false);
    return attempt.opening;
  }

  private async open(attempt: ViewAttempt<Item>): Promise<void> {
    try {
      if (!this.isCurrent(attempt) || this._opener === null) return;
      const view = await this._opener(attempt.controller.signal);
      if (!this.isCurrent(attempt)) {
        this.closeView(view);
        return;
      }
      attempt.view = view;
      const unsubscribe = view.subscribe(() => {
        if (!this.isCurrent(attempt)) return;
        const state = view.getSnapshot();
        if (this.isCurrent(attempt)) this.publish(state, attempt.pagination !== undefined);
      });
      if (!this.isCurrent(attempt)) {
        this.unsubscribe(unsubscribe);
        if (this._attempt === attempt) this.closeAttempt();
        return;
      }
      attempt.unsubscribe = unsubscribe;
      // Subscribe first, then read: opening and listener attachment can have a gap.
      const state = view.getSnapshot();
      if (this.isCurrent(attempt)) this.publish(state, attempt.pagination !== undefined);
    } catch (cause: unknown) {
      if (this.isCurrent(attempt)) {
        this.closeAttempt();
        this.publish({
          status: 'error',
          records: EMPTY_RECORDS,
          hasMore: false,
          current: false,
          error: toError(cause),
        }, false);
      }
      throw cause;
    }
  }

  private closeAttempt(): void {
    const attempt = this._attempt;
    this._attempt = undefined;
    this.releaseAttempt(attempt);
  }

  private releaseAttempt(attempt: ViewAttempt<Item> | undefined): void {
    if (attempt === undefined) return;
    const unsubscribe = attempt.unsubscribe;
    attempt.unsubscribe = undefined;
    if (unsubscribe !== undefined) this.unsubscribe(unsubscribe);
    attempt.controller.abort();
    const view = attempt.view;
    attempt.view = undefined;
    if (view !== undefined) this.closeView(view);
  }

  private unsubscribe(unsubscribe: () => void): void {
    try {
      unsubscribe();
    } catch (cause: unknown) {
      reportCleanupError(cause);
    }
  }

  private closeView(view: RecordView<Item>): void {
    try {
      void view.close().catch(reportCleanupError);
    } catch (cause: unknown) {
      reportCleanupError(cause);
    }
  }

  private isExpandable(view: RecordView<Item>): view is ExpandableRecordView<Item> {
    return 'loadMore' in view && typeof view.loadMore === 'function';
  }

  private result(
    state: RecordViewState<Item> | IdleRecordViewState<Item>,
    isLoadingMore: boolean,
  ): RecordViewResult<Item> {
    return Object.freeze({ ...state, retry: this.retry, isLoadingMore });
  }

  private publish(state: RecordViewState<Item> | IdleRecordViewState<Item>, isLoadingMore: boolean): void {
    if (state === this._viewState && isLoadingMore === this._snapshot.isLoadingMore) return;
    this._viewState = state;
    if (state === IDLE && !isLoadingMore) {
      this._snapshot = this._idle;
    } else if (state === LOADING && !isLoadingMore) {
      this._snapshot = this._loading;
    } else {
      this._snapshot = this.result(state, isLoadingMore);
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
  }
}
