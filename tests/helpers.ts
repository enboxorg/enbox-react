import type { ConnectionSnapshot, ConnectionStore, Enbox, ExpandableRecordView, RecordViewState } from '@enbox/browser';

import { AuthSession } from '@enbox/browser';
import { onTestFinished, vi } from 'vitest';

/** Release manually subscribed observers even when an assertion fails. */
export function subscribeObserver(
  observer: { subscribe(notify: () => void): () => void },
  notify: () => void = () => {},
): () => void {
  const unsubscribe = observer.subscribe(notify);
  onTestFinished(unsubscribe);
  return unsubscribe;
}

/** Test doubles model the external-store boundary, not the wallet protocol. */
export function controlledClient(initial: ConnectionSnapshot = { phase: 'disconnected' }) {
  let snapshot = Object.freeze(initial);
  const listeners = new Set<(snapshot: ConnectionSnapshot) => void>();
  const client = {
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: ConnectionSnapshot) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    initialize: vi.fn(async () => snapshot),
    connect: vi.fn(async () => snapshot),
    connectVault: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    disconnect: vi.fn(async () => snapshot),
    refreshDwnEndpoints: vi.fn(async () => snapshot),
    retryRemote: vi.fn(async (_endpoint: string) => snapshot),
    dispose: vi.fn(async () => {}),
  } satisfies ConnectionStore;
  return {
    client,
    listeners,
    publish(next: ConnectionSnapshot): void {
      snapshot = Object.freeze(next);
      for (const listener of listeners) listener(snapshot);
    },
  };
}

export function connected(
  enbox: Enbox = facade(), did = 'did:example:alice', lifetime = new AbortController(),
): Extract<ConnectionSnapshot, { phase: 'connected' }> {
  const session = new AuthSession({
    agent: {} as AuthSession['agent'],
    did,
    signal: lifetime.signal,
    identity: { didUri: did, name: did },
  });
  return { phase: 'connected', enbox, session };
}

/** Only the API binding function is needed in connection-boundary tests. */
export function facade(using = vi.fn()): Enbox {
  return { using } as unknown as Enbox;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class ControlledView<T> implements ExpandableRecordView<T> {
  private _state: RecordViewState<T>;
  public readonly listeners = new Set<(state: RecordViewState<T>) => void>();
  public readonly close = vi.fn(async (): Promise<void> => { this.listeners.clear(); });
  public readonly loadMore = vi.fn(async (): Promise<void> => {});
  public onSubscribe: (() => void) | undefined;

  public constructor(records: readonly T[] = []) {
    this._state = Object.freeze({ status: 'ready', records: Object.freeze([...records]), hasMore: false, current: true });
  }

  public readonly getSnapshot = (): RecordViewState<T> => this._state;
  public readonly subscribe = (listener: (state: RecordViewState<T>) => void): (() => void) => {
    this.onSubscribe?.();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  public async ready(): Promise<Extract<RecordViewState<T>, { status: 'ready' }>> {
    if (this._state.status !== 'ready') throw new Error('Test view is not ready.');
    return this._state;
  }

  public publish(next: RecordViewState<T>): void {
    this._state = Object.freeze(next);
    for (const listener of this.listeners) listener(this._state);
  }
}
