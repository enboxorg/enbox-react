import type { ConnectionStore, Enbox } from '@enbox/browser';

import type { ConnectionBinding } from './connection-binding.js';
import { isConnectionBindingCurrent, subscribeToConnectionBinding } from './connection-binding.js';
import { notifyListeners } from './listeners.js';
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
  private readonly _pendingInvocations = new Map<number, Variables>();
  private _emptySnapshot: EnboxMutationSnapshot<Variables> = Object.freeze({ ...EMPTY });
  private _snapshot: EnboxMutationSnapshot<Variables> = this._emptySnapshot;
  private _subscriptionGeneration = 0;
  private _latestInvocationId = 0;
  private _unsubscribe: (() => void) | undefined;

  public constructor(
    private readonly _client: ConnectionStore,
    private readonly _binding: ConnectionBinding,
  ) {}

  public readonly getSnapshot = (): EnboxMutationSnapshot<Variables> => this.isCurrent() ? this._snapshot : this._emptySnapshot;
  public readonly getServerSnapshot = (): EnboxMutationSnapshot<Variables> => EMPTY;
  public readonly subscribe = (notify: () => void): (() => void) => {
    // Each subscription owns its cleanup, even when callbacks are identical.
    const listener = (): void => { notify(); };
    this._listeners.add(listener);
    if (this._listeners.size === 1) {
      this._unsubscribe = subscribeToConnectionBinding(this._client, this._binding, () => {
        if (!this.isCurrent()) this.clear();
      });
    }
    return () => {
      if (!this._listeners.delete(listener) || this._listeners.size !== 0) return;
      const unsubscribe = this._unsubscribe;
      this._unsubscribe = undefined;
      // Native cleanup can subscribe again and start work for the replacement.
      this.clear();
      try {
        unsubscribe?.();
      } catch (cause: unknown) {
        reportCleanupError(cause);
      }
    };
  };

  /** Clear presentation errors while allowing every issued write to finish. */
  public readonly reset = (): void => {
    if (!this.isCurrent()) return;
    // Older failures cannot restore an error cleared by this reset.
    this._latestInvocationId += 1;
    this.publish(undefined);
  };

  public async run<Input extends Variables, Result>(
    operation: (enbox: Enbox, variables: Input) => Promise<Result>,
    variables: Input,
  ): Promise<Result> {
    if (!this.isCurrent()) throw new EnboxBindingChangedError();
    const id = ++this._latestInvocationId;
    const enbox = this._binding.enbox;
    if (enbox === undefined || this._binding.session === undefined) {
      const error = new EnboxNotConnectedError();
      this.publish(error);
      throw error;
    }

    const generation = this._subscriptionGeneration;
    this._pendingInvocations.set(id, variables);
    this.publish(undefined);
    try {
      // A pending-state listener can synchronously retire this binding.
      if (!this.canPublish(generation)) throw new EnboxBindingChangedError();
      return await operation(enbox, variables);
    } catch (cause: unknown) {
      if (this.canPublish(generation) && id === this._latestInvocationId) this.publish(toError(cause));
      throw cause;
    } finally {
      if (this.canPublish(generation)) {
        this._pendingInvocations.delete(id);
        this.publish(this._snapshot.error);
      }
    }
  }

  public readonly isCurrent = (): boolean => this._listeners.size > 0
    && isConnectionBindingCurrent(this._client, this._binding);

  /** Capture a UI guard that cannot become current again after resubscription. */
  public captureGuard(): () => boolean {
    const generation = this._subscriptionGeneration;
    return () => this._subscriptionGeneration === generation && this.isCurrent();
  }

  private canPublish(generation: number): boolean {
    return generation === this._subscriptionGeneration && this.isCurrent();
  }

  private clear(): void {
    this._subscriptionGeneration += 1;
    this._pendingInvocations.clear();
    // A new identity makes React replace UI guards even when both lifetimes are idle.
    this._emptySnapshot = Object.freeze({ ...EMPTY });
    this._snapshot = this._emptySnapshot;
    this.notify();
  }

  private publish(error: Error | undefined): void {
    const pendingCount = this._pendingInvocations.size;
    if (pendingCount === this._snapshot.pendingCount && error === this._snapshot.error) return;
    this._snapshot = pendingCount === 0 && error === undefined
      ? this._emptySnapshot
      : Object.freeze({
        pendingCount,
        pendingVariables: pendingCount === this._snapshot.pendingCount
          ? this._snapshot.pendingVariables : Object.freeze([...this._pendingInvocations.values()]),
        isPending: pendingCount > 0,
        error,
      });
    this.notify();
  }

  private notify(): void {
    notifyListeners(this._listeners);
  }
}
