import { EnboxBindingChangedError } from '../errors.js';
import { reportCleanupError, toError } from './errors.js';

export type BindingGuard = {
  isCurrent(): boolean;
  subscribe(notify: () => void): () => void;
};

export type OwnedViewOptions = Readonly<{
  bindingGuard?: BindingGuard | undefined;
  retainWithoutSubscribers?: boolean;
}>;

type ViewState = Readonly<
  | { status: 'loading' | 'ready'; error?: never }
  | { status: 'error'; error: Error }
>;
type IdleState = Readonly<{ status: 'idle'; error?: never }>;

type ObservableView<State> = {
  getSnapshot(): State;
  subscribe(notify: (state: State) => void): () => void;
  close(): Promise<void>;
};

export type ViewAttempt<View> = {
  readonly abortController: AbortController;
  /** For current attempts, resolves after attachment rather than local readiness. */
  readonly opening: Promise<void>;
  view: View | undefined;
  unsubscribe: (() => void) | undefined;
};

type ViewPresentation<State, Idle, Result, View> = {
  idle: Idle;
  loading: State;
  createErrorState(error: Error): State;
  createSnapshot(state: State | Idle, retry: () => Promise<void>, attempt: ViewAttempt<View> | undefined): Result;
  sameControls?(previous: Result, next: Result): boolean;
};

/** Shared ownership and opening lifecycle for native observable views. */
export class OwnedViewObserver<
  State extends ViewState,
  Idle extends IdleState,
  Result extends (State | Idle) & Readonly<{ retry: () => Promise<void> }>,
  View extends ObservableView<State>,
> {
  private readonly _listeners = new Set<() => void>();
  private readonly _idleSnapshot: Result;
  private readonly _loadingSnapshot: Result;
  private _snapshot: Result;
  protected _state: State | Idle;
  protected _attempt: ViewAttempt<View> | undefined;
  private _active = false;
  private _closed = false;
  private _attemptGeneration = 0;
  private _unsubscribeBinding: (() => void) | undefined;
  private readonly _closing = new Set<Promise<void>>();
  private readonly _bindingGuard: BindingGuard | undefined;
  private readonly _retainWithoutSubscribers: boolean;

  public constructor(
    private readonly _openView: ((signal: AbortSignal) => Promise<View>) | null,
    private readonly _presentation: ViewPresentation<State, Idle, Result, View>,
    options: OwnedViewOptions = {},
  ) {
    this._bindingGuard = options.bindingGuard;
    this._retainWithoutSubscribers = options.retainWithoutSubscribers ?? false;
    this._idleSnapshot = this.createSnapshot(_presentation.idle);
    this._loadingSnapshot = this.createSnapshot(_presentation.loading);
    this._state = _openView === null ? _presentation.idle : _presentation.loading;
    this._snapshot = _openView === null ? this._idleSnapshot : this._loadingSnapshot;
  }

  public readonly getSnapshot = (): Result =>
    !this._closed && this.isBindingCurrent() ? this._snapshot : this._idleSnapshot;

  public readonly getServerSnapshot = (): Result => this._idleSnapshot;

  public readonly subscribe = (notify: () => void): (() => void) => {
    if (this._closed) return () => {};
    const listener = (): void => { notify(); };
    this._listeners.add(listener);
    if (!this._active) this.start();
    return () => {
      if (!this._listeners.delete(listener)) return;
      if (this._listeners.size === 0 && !this._retainWithoutSubscribers) this.stop();
    };
  };

  /** Close permanently; a view still opening is closed when it eventually resolves. */
  public readonly close = async (): Promise<void> => {
    if (!this._closed) {
      this._closed = true;
      this.stop();
      this._listeners.clear();
    }
    await Promise.all(this._closing);
  };

  /** Wait for usable local state; cancelling one waiter leaves the owner intact. */
  public readonly ready = (options: { signal?: AbortSignal } = {}): Promise<
    Extract<Result, { status: 'ready' }>
  > => new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      const state = this.getSnapshot();
      const waitingForState = error === undefined && state.status !== 'ready' && state.status !== 'error'
        && !this._closed && this._openView !== null && this.isBindingCurrent();
      if (waitingForState) return;
      settled = true;
      unsubscribe?.();
      options.signal?.removeEventListener('abort', abort);
      if (error !== undefined) reject(error);
      else if (state.status === 'ready') resolve(state as Extract<Result, { status: 'ready' }>);
      else reject(state.status === 'error' ? state.error : new EnboxBindingChangedError());
    };
    const abort = (): void => finish(options.signal?.reason ?? new EnboxBindingChangedError());
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    unsubscribe = this.subscribe(() => finish());
    // Subscription can settle the waiter before its cleanup is assigned.
    if (settled) unsubscribe();
    else finish();
  });

  /** Reopen an active selection, sharing an existing opening attempt. */
  public readonly retry = (): Promise<void> => {
    if (!this._active || this._openView === null || !this.isBindingCurrent()) {
      return Promise.reject(new EnboxBindingChangedError());
    }
    if (this._attempt !== undefined && this._attempt.view === undefined) return this._attempt.opening;
    return this.beginOpening();
  };

  protected isBindingCurrent(): boolean {
    return this._bindingGuard?.isCurrent() ?? true;
  }

  protected isCurrent(attempt: ViewAttempt<View>): boolean {
    return this._active && this._attempt === attempt
      && !attempt.abortController.signal.aborted && this.isBindingCurrent();
  }

  protected publish(state: State | Idle): void {
    const snapshot = this.createSnapshot(state);
    const sameControls = this._presentation.sameControls ?? (() => true);
    if (state === this._state && sameControls(this._snapshot, snapshot)) return;
    this._state = state;
    if (state === this._presentation.idle && sameControls(this._idleSnapshot, snapshot)) {
      this._snapshot = this._idleSnapshot;
    } else if (state === this._presentation.loading && sameControls(this._loadingSnapshot, snapshot)) {
      this._snapshot = this._loadingSnapshot;
    } else {
      this._snapshot = snapshot;
    }
    this.notify();
  }

  private start(): void {
    this._active = true;
    this._unsubscribeBinding = this._bindingGuard?.subscribe(() => {
      if (!this.isBindingCurrent()) {
        this.closeAttempt();
        this.publish(this._presentation.idle);
      }
    });
    if (this._openView !== null && this.isBindingCurrent()) void this.beginOpening().catch(() => {});
  }

  private stop(): void {
    this._active = false;
    const unsubscribeBinding = this._unsubscribeBinding;
    this._unsubscribeBinding = undefined;
    if (unsubscribeBinding !== undefined) this.runCleanup(unsubscribeBinding);
    this.closeAttempt();
    this._state = this._openView === null ? this._presentation.idle : this._presentation.loading;
    this._snapshot = this._openView === null ? this._idleSnapshot : this._loadingSnapshot;
    this.notify();
  }

  private beginOpening(): Promise<void> {
    const previous = this._attempt;
    const attempt: ViewAttempt<View> = {
      abortController: new AbortController(),
      opening: Promise.resolve().then(() => this.attachView(attempt)),
      view: undefined,
      unsubscribe: undefined,
    };
    // Register the replacement before cleanup can request another retry.
    this._attempt = attempt;
    this._attemptGeneration += 1;
    this.releaseAttempt(previous);
    if (this.isCurrent(attempt)) this.publish(this._presentation.loading);
    return attempt.opening;
  }

  private async attachView(attempt: ViewAttempt<View>): Promise<void> {
    try {
      if (!this.isCurrent(attempt) || this._openView === null) return;
      const view = await this._openView(attempt.abortController.signal);
      if (!this.isCurrent(attempt)) { this.trackViewClose(view); return; }
      attempt.view = view;
      const unsubscribe = view.subscribe(() => {
        if (!this.isCurrent(attempt)) return;
        const state = view.getSnapshot();
        if (this.isCurrent(attempt)) this.publish(state);
      });
      if (!this.isCurrent(attempt)) {
        this.runCleanup(unsubscribe);
        if (this._attempt === attempt) this.closeAttempt();
        return;
      }
      attempt.unsubscribe = unsubscribe;
      // Read after attaching so changes made during subscription are visible.
      const state = view.getSnapshot();
      if (this.isCurrent(attempt)) this.publish(state);
    } catch (cause: unknown) {
      if (this.isCurrent(attempt)) {
        const generation = this.closeAttempt();
        // Cleanup can synchronously begin another attempt or retire this owner.
        // Its readiness waiters must not receive the obsolete opening failure.
        if (this._active && this._attemptGeneration === generation && this.isBindingCurrent()) {
          this.publish(this._presentation.createErrorState(toError(cause)));
        }
      }
      throw cause;
    }
  }

  private closeAttempt(): number {
    const generation = ++this._attemptGeneration;
    const attempt = this._attempt;
    this._attempt = undefined;
    this.releaseAttempt(attempt);
    return generation;
  }

  private releaseAttempt(attempt: ViewAttempt<View> | undefined): void {
    if (attempt === undefined) return;
    const unsubscribe = attempt.unsubscribe;
    attempt.unsubscribe = undefined;
    if (unsubscribe !== undefined) this.runCleanup(unsubscribe);
    attempt.abortController.abort();
    const view = attempt.view;
    attempt.view = undefined;
    if (view !== undefined) this.trackViewClose(view);
  }

  private runCleanup(unsubscribe: () => void): void {
    try { unsubscribe(); } catch (cause: unknown) { reportCleanupError(cause); }
  }

  private trackViewClose(view: View): void {
    let finish!: () => void;
    const closing = new Promise<void>((resolve) => { finish = resolve; });
    // Native close can synchronously close this owner; register cleanup first.
    this._closing.add(closing);
    const complete = (): void => { this._closing.delete(closing); finish(); };
    try {
      void Promise.resolve(view.close()).catch(reportCleanupError).then(complete);
    } catch (cause: unknown) {
      reportCleanupError(cause);
      complete();
    }
  }

  private createSnapshot(state: State | Idle): Result {
    return this._presentation.createSnapshot(state, this.retry, this._attempt);
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
  }
}
