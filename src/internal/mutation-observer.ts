import type { ConnectionStore, Enbox } from '@enbox/browser';

import type { ConnectionBinding } from './connection-binding.js';
import { isConnectionBindingCurrent, subscribeToConnectionBinding } from './connection-binding.js';
import { EnboxBindingChangedError, EnboxNotConnectedError } from '../errors.js';
import { reportCleanupError, toError } from './errors.js';

export type EnboxMutationSnapshot<Variables = unknown> = Readonly<{
  pendingCount: number;
  pendingVariables: readonly Variables[];
  isPending: boolean;
  error: Error | undefined;
}>;

const EMPTY: EnboxMutationSnapshot<never> = Object.freeze({
  pendingCount: 0,
  pendingVariables: Object.freeze([]),
  isPending: false,
  error: undefined,
});

/** Subscribers own presentation state for one session; each call owns its Promise. */
export class EnboxMutationObserver<Variables = unknown> {
  private readonly _listeners = new Set<() => void>();
  private readonly _pending = new Map<number, Variables>();
  private _snapshot: EnboxMutationSnapshot<Variables> = EMPTY;
  private _active = false;
  private _generation = 0;
  private _sequence = 0;
  private _latest = 0;
  private _unsubscribe: (() => void) | undefined;

  public constructor(
    private readonly _client: ConnectionStore,
    private readonly _expected: ConnectionBinding,
  ) {}

  public readonly getSnapshot = (): EnboxMutationSnapshot<Variables> => this.isCurrent() ? this._snapshot : EMPTY;
  public readonly getServerSnapshot = (): EnboxMutationSnapshot<Variables> => EMPTY;
  public readonly subscribe = (notify: () => void): (() => void) => {
    // Each subscription owns its cleanup, even when callbacks are identical.
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
    this._generation += 1;
    this._unsubscribe = subscribeToConnectionBinding(this._client, this._expected, () => {
      if (!this.isCurrent()) this.clear();
    });
  }

  private stop(): void {
    this._active = false;
    const unsubscribe = this._unsubscribe;
    this._unsubscribe = undefined;
    try {
      unsubscribe?.();
    } catch (cause: unknown) {
      reportCleanupError(cause);
    }
    this.clear();
  }

  public readonly reset = (): void => {
    if (!this._active || !this.isCurrent()) return;
    this._latest = ++this._sequence;
    this.publish(undefined);
  };

  public async run<Input extends Variables, Result>(
    operation: (enbox: Enbox, variables: Input) => Promise<Result>,
    variables: Input,
  ): Promise<Result> {
    if (!this._active || !this.isCurrent()) throw new EnboxBindingChangedError();
    const id = ++this._sequence;
    this._latest = id;
    const enbox = this._expected.enbox;
    if (enbox === undefined || this._expected.session === undefined) {
      const error = new EnboxNotConnectedError();
      this.publish(error);
      throw error;
    }

    const generation = this._generation;
    this._pending.set(id, variables);
    this.publish(undefined);
    try {
      // A pending-state listener can synchronously retire this binding.
      if (!this.canPublish(generation)) throw new EnboxBindingChangedError();
      return await operation(enbox, variables);
    } catch (cause: unknown) {
      if (this.canPublish(generation) && id === this._latest) this.publish(toError(cause));
      throw cause;
    } finally {
      if (this.canPublish(generation)) {
        this._pending.delete(id);
        this.publish(this._snapshot.error);
      }
    }
  }

  public readonly isCurrent = (): boolean => this._active
    && isConnectionBindingCurrent(this._client, this._expected);

  private canPublish(generation: number): boolean {
    return this._active && generation === this._generation && this.isCurrent();
  }

  private clear(): void {
    this._generation += 1;
    this._pending.clear();
    this._snapshot = EMPTY;
    this.notify();
  }

  private publish(error: Error | undefined): void {
    const pendingCount = this._pending.size;
    if (pendingCount === this._snapshot.pendingCount && error === this._snapshot.error) return;
    this._snapshot = pendingCount === 0 && error === undefined
      ? EMPTY
      : Object.freeze({
        pendingCount,
        pendingVariables: pendingCount === this._snapshot.pendingCount
          ? this._snapshot.pendingVariables : Object.freeze([...this._pending.values()]),
        isPending: pendingCount > 0,
        error,
      });
    this.notify();
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
  }
}
