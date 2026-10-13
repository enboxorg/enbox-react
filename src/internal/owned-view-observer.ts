import { EnboxBindingChangedError } from '../errors.js';
import { reportCleanupError, toError } from './errors.js';

export type BindingGuard = {
  isCurrent(): boolean;
  subscribe(notify: () => void): () => void;
};

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
  readonly controller: AbortController;
  readonly opening: Promise<void>;
  view: View | undefined;
  unsubscribe: (() => void) | undefined;
};

type Presentation<State, Idle, Result, View> = {
  idle: Idle;
  loading: State;
  error(error: Error): State;
  result(state: State | Idle, retry: () => Promise<void>, attempt: ViewAttempt<View> | undefined): Result;
  sameResult?(previous: Result, next: Result): boolean;
};

/** Shared ownership and opening lifecycle for native observable views. */
export class OwnedViewObserver<
  State extends ViewState,
  Idle extends IdleState,
  Result extends (State | Idle) & Readonly<{ retry: () => Promise<void> }>,
  View extends ObservableView<State>,
> {
  private readonly _listeners = new Set<() => void>();
  private readonly _idle: Result;
  private readonly _loading: Result;
  private _snapshot: Result;
  protected _viewState: State | Idle;
  protected _attempt: ViewAttempt<View> | undefined;
  private _active = false;
  private _closed = false;
  private _unsubscribeBinding: (() => void) | undefined;
  private readonly _closing = new Set<Promise<void>>();

  public constructor(
    private readonly _opener: ((signal: AbortSignal) => Promise<View>) | null,
    private readonly _presentation: Presentation<State, Idle, Result, View>,
    private readonly _bindingGuard?: BindingGuard,
    private readonly _keepAlive = false,
  ) {
    this._idle = this.result(_presentation.idle);
    this._loading = this.result(_presentation.loading);
    this._viewState = _opener === null ? _presentation.idle : _presentation.loading;
    this._snapshot = _opener === null ? this._idle : this._loading;
  }

  public readonly getSnapshot = (): Result =>
    !this._closed && this.isBindingCurrent() ? this._snapshot : this._idle;

  public readonly getServerSnapshot = (): Result => this._idle;

  public readonly subscribe = (notify: () => void): (() => void) => {
    if (this._closed) return () => {};
    const listener = (): void => { notify(); };
    this._listeners.add(listener);
    if (!this._active) this.start();
    return () => {
      if (!this._listeners.delete(listener)) return;
      if (this._listeners.size === 0 && !this._keepAlive) this.stop();
    };
  };

  /** Owner release is terminal; hook unsubscription can later reopen the view. */
  public readonly close = async (): Promise<void> => {
    if (!this._closed) {
      this._closed = true;
      this.stop();
      this._listeners.clear();
    }
    await Promise.all(this._closing);
  };

  public readonly ready = (options: { signal?: AbortSignal } = {}): Promise<
    Extract<Result, { status: 'ready' }>
  > => new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      const state = this.getSnapshot();
      if (error === undefined && state.status !== 'ready' && state.status !== 'error'
        && !this._closed && this._opener !== null && this.isBindingCurrent()) return;
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
    if (settled) unsubscribe();
    else finish();
  });

  public readonly retry = (): Promise<void> => {
    if (!this._active || this._opener === null || !this.isBindingCurrent()) {
      return Promise.reject(new EnboxBindingChangedError());
    }
    if (this._attempt !== undefined && this._attempt.view === undefined) return this._attempt.opening;
    return this.begin();
  };

  protected isBindingCurrent(): boolean {
    return this._bindingGuard?.isCurrent() ?? true;
  }

  protected isCurrent(attempt: ViewAttempt<View>): boolean {
    return this._active && this._attempt === attempt
      && !attempt.controller.signal.aborted && this.isBindingCurrent();
  }

  protected publish(state: State | Idle): void {
    const result = this.result(state);
    const same = this._presentation.sameResult ?? (() => true);
    if (state === this._viewState && same(this._snapshot, result)) return;
    this._viewState = state;
    this._snapshot = state === this._presentation.idle && same(this._idle, result) ? this._idle
      : state === this._presentation.loading && same(this._loading, result) ? this._loading : result;
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
    if (this._opener !== null && this.isBindingCurrent()) void this.begin().catch(() => {});
  }

  private stop(): void {
    this._active = false;
    const unsubscribeBinding = this._unsubscribeBinding;
    this._unsubscribeBinding = undefined;
    if (unsubscribeBinding !== undefined) this.unsubscribe(unsubscribeBinding);
    this.closeAttempt();
    this._viewState = this._opener === null ? this._presentation.idle : this._presentation.loading;
    this._snapshot = this._opener === null ? this._idle : this._loading;
    this.notify();
  }

  private begin(): Promise<void> {
    const previous = this._attempt;
    const attempt: ViewAttempt<View> = {
      controller: new AbortController(),
      opening: Promise.resolve().then(() => this.open(attempt)),
      view: undefined,
      unsubscribe: undefined,
    };
    // Register the replacement before cleanup can request another retry.
    this._attempt = attempt;
    this.releaseAttempt(previous);
    if (this.isCurrent(attempt)) this.publish(this._presentation.loading);
    return attempt.opening;
  }

  private async open(attempt: ViewAttempt<View>): Promise<void> {
    try {
      if (!this.isCurrent(attempt) || this._opener === null) return;
      const view = await this._opener(attempt.controller.signal);
      if (!this.isCurrent(attempt)) { this.closeView(view); return; }
      attempt.view = view;
      const unsubscribe = view.subscribe(() => {
        if (!this.isCurrent(attempt)) return;
        const state = view.getSnapshot();
        if (this.isCurrent(attempt)) this.publish(state);
      });
      if (!this.isCurrent(attempt)) {
        this.unsubscribe(unsubscribe);
        if (this._attempt === attempt) this.closeAttempt();
        return;
      }
      attempt.unsubscribe = unsubscribe;
      // Read after attaching so changes made during subscription are visible.
      const state = view.getSnapshot();
      if (this.isCurrent(attempt)) this.publish(state);
    } catch (cause: unknown) {
      if (this.isCurrent(attempt)) {
        this.closeAttempt();
        this.publish(this._presentation.error(toError(cause)));
      }
      throw cause;
    }
  }

  private closeAttempt(): void {
    const attempt = this._attempt;
    this._attempt = undefined;
    this.releaseAttempt(attempt);
  }

  private releaseAttempt(attempt: ViewAttempt<View> | undefined): void {
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
    try { unsubscribe(); } catch (cause: unknown) { reportCleanupError(cause); }
  }

  private closeView(view: View): void {
    let finish!: () => void;
    const closing = new Promise<void>((resolve) => { finish = resolve; });
    this._closing.add(closing);
    const complete = (): void => { this._closing.delete(closing); finish(); };
    try {
      void Promise.resolve(view.close()).catch(reportCleanupError).then(complete);
    } catch (cause: unknown) {
      reportCleanupError(cause);
      complete();
    }
  }

  private result(state: State | Idle): Result {
    return this._presentation.result(state, this.retry, this._attempt);
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
  }
}
