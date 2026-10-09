import type { ConnectionSnapshot } from '@enbox/browser';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxBindingChangedError, EnboxNotConnectedError, EnboxProvider, useEnboxMutation } from '../src/index.js';
import { EnboxMutationObserver } from '../src/internal/mutation-observer.js';
import { connected, controlledClient, deferred, facade, subscribeObserver } from './helpers.js';

describe('session-bound mutations', () => {
  it('clears pending presentation even when connection cleanup throws', async () => {
    const initial = connected();
    const { client } = controlledClient(initial);
    const failure = new Error('unsubscribe failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = {
      ...client,
      subscribe: (notify: (snapshot: ConnectionSnapshot) => void) => {
        const unsubscribe = client.subscribe(notify);
        return () => { unsubscribe(); throw failure; };
      },
    };
    const observer = new EnboxMutationObserver(store, initial);
    const stop = subscribeObserver(observer);
    const job = deferred<string>();
    const run = observer.run(async () => job.promise, undefined);
    try {
      expect(observer.getSnapshot().pendingCount).toBe(1);
      expect(stop).not.toThrow();
      expect(observer.getSnapshot().pendingCount).toBe(0);
      expect(warn).toHaveBeenCalledWith('[@enbox/react] Resource cleanup failed.', failure);
    } finally {
      stop();
      job.resolve('saved');
      await run;
      warn.mockRestore();
    }
  });

  it('watches the session only while subscribed and rejects released runners', async () => {
    const initial = connected();
    const { client, listeners } = controlledClient(initial);
    const observer = new EnboxMutationObserver(client, { enbox: initial.enbox, session: initial.session });
    const operation = vi.fn(async () => 'saved');
    expect(listeners.size).toBe(0);
    const notify = vi.fn();
    const first = subscribeObserver(observer, notify);
    const second = subscribeObserver(observer, notify);
    expect(listeners.size).toBe(1);
    first();
    first();
    expect(await observer.run(operation, undefined)).toBe('saved');
    second();
    expect(listeners.size).toBe(0);
    await expect(observer.run(operation, undefined)).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(operation).toHaveBeenCalledOnce();
    const replacement = subscribeObserver(observer, notify);
    first();
    second();
    try {
      expect(await observer.run(operation, undefined)).toBe('saved');
      expect(listeners.size).toBe(1);
    } finally {
      replacement();
    }
    expect(listeners.size).toBe(0);
  });

  it.each([
    ['a null-prototype object', () => Object.create(null) as unknown],
    ['throwing coercion', () => ({ [Symbol.toPrimitive](): never { throw new Error('coercion failed'); } })],
    ['a revoked proxy', () => {
      const proxy = Proxy.revocable({}, {});
      proxy.revoke();
      return proxy.proxy;
    }],
  ] as const)('preserves the original rejection for %s', async (_label, createFailure) => {
    const initial = connected();
    const { client } = controlledClient(initial);
    const observer = new EnboxMutationObserver(client, { enbox: initial.enbox, session: initial.session });
    const stop = subscribeObserver(observer);
    const failure: unknown = createFailure();
    try {
      await expect(observer.run(async () => { throw failure; }, undefined)).rejects.toBe(failure);
      expect(observer.getSnapshot().error).toBeInstanceOf(Error);
      expect(observer.getSnapshot().error?.cause).toBe(failure);
    } finally {
      stop();
    }
  });

  it('rechecks the binding after pending-state subscribers change the session', async () => {
    const initial = connected();
    const { client, publish } = controlledClient(initial);
    const observer = new EnboxMutationObserver(client, { enbox: initial.enbox, session: initial.session });
    const stop = subscribeObserver(observer);
    const unsubscribe = subscribeObserver(observer, () => {
      if (observer.getSnapshot().isPending) publish(connected(facade(), 'did:example:bob'));
    });
    const operation = vi.fn(async () => 'should not run');
    try {
      await expect(observer.run(operation, undefined)).rejects.toBeInstanceOf(EnboxBindingChangedError);
      expect(operation).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      stop();
    }
  });

  it('rejects an old identity handler before React commits the new UI', async () => {
    const initial = connected();
    const { client, publish } = controlledClient(initial);
    const operation = vi.fn(async (_enbox, value: string) => value);
    const hook = renderHook(() => useEnboxMutation(operation), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    const oldRun = hook.result.current.run;
    let rejected!: Promise<string>;
    act(() => {
      publish(connected(facade(), 'did:example:bob'));
      rejected = oldRun('alice draft');
    });
    await expect(rejected).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(operation).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.result.current.run('bob draft')).toBe('bob draft'); });
    expect(operation.mock.calls[0]?.[0]).toBe(client.getSnapshot().enbox);
  });

  it('also rejects replaced facades for the same DID and aborted sessions', async () => {
    const lifetime = new AbortController();
    const initial = connected(facade(), 'did:example:alice', lifetime);
    const { client, publish } = controlledClient(initial);
    const operation = vi.fn(async () => 'ok');
    const observer = new EnboxMutationObserver(client, { enbox: initial.enbox, session: initial.session });
    const stop = subscribeObserver(observer);
    lifetime.abort();
    await expect(observer.run(operation, undefined)).rejects.toBeInstanceOf(EnboxBindingChangedError);
    publish(connected(facade(), initial.session.did));
    await expect(observer.run(operation, undefined)).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(operation).not.toHaveBeenCalled();
    stop();
  });

  it('requires a connection without invoking the operation', async () => {
    const { client } = controlledClient();
    const observer = new EnboxMutationObserver(client, { enbox: undefined, session: undefined });
    const stop = subscribeObserver(observer);
    const operation = vi.fn(async () => 'wrong');
    await expect(observer.run(operation, undefined)).rejects.toBeInstanceOf(EnboxNotConnectedError);
    expect(operation).not.toHaveBeenCalled();
    expect(observer.getSnapshot().error).toBeInstanceOf(EnboxNotConnectedError);
    stop();
  });

  it('counts concurrent calls, keeps the newest error, and preserves each Promise', async () => {
    const initial = connected();
    const { client } = controlledClient(initial);
    const observer = new EnboxMutationObserver(client, { enbox: initial.enbox, session: initial.session });
    const stop = subscribeObserver(observer);
    const first = deferred<string>();
    const second = deferred<string>();
    const firstRun = observer.run(async () => first.promise, undefined);
    const secondRun = observer.run(async () => second.promise, undefined);
    expect(observer.getSnapshot().pendingCount).toBe(2);
    const newest = new Error('latest failed');
    second.reject(newest);
    await expect(secondRun).rejects.toBe(newest);
    expect(observer.getSnapshot().pendingCount).toBe(1);
    expect(observer.getSnapshot().error).toBe(newest);
    const oldest = new Error('older failed later');
    first.reject(oldest);
    await expect(firstRun).rejects.toBe(oldest);
    expect(observer.getSnapshot().pendingCount).toBe(0);
    expect(observer.getSnapshot().error).toBe(newest);
    expect(observer.getSnapshot()).toBe(observer.getSnapshot());
    stop();
  });

  it('resets presentation without cancelling an issued write', async () => {
    const initial = connected();
    const { client } = controlledClient(initial);
    const observer = new EnboxMutationObserver(client, { enbox: initial.enbox, session: initial.session });
    const stop = subscribeObserver(observer);
    const job = deferred<string>();
    const run = observer.run(async () => job.promise, undefined);
    observer.reset();
    expect(observer.getSnapshot().isPending).toBe(true);
    job.reject('raw rejection');
    await expect(run).rejects.toBe('raw rejection');
    expect(observer.getSnapshot().error).toBeUndefined();
    expect(observer.getSnapshot().isPending).toBe(false);
    stop();
  });

  it('fences old completions after cleanup and reopening', async () => {
    const initial = connected();
    const { client } = controlledClient(initial);
    const observer = new EnboxMutationObserver(client, { enbox: initial.enbox, session: initial.session });
    const stop = subscribeObserver(observer);
    const old = deferred<string>();
    const oldRun = observer.run(async () => old.promise, undefined);
    stop();
    const stopFresh = subscribeObserver(observer);
    const fresh = deferred<string>();
    const freshRun = observer.run(async () => fresh.promise, undefined);
    old.resolve('old');
    expect(await oldRun).toBe('old');
    expect(observer.getSnapshot().pendingCount).toBe(1);
    fresh.resolve('new');
    expect(await freshRun).toBe('new');
    expect(observer.getSnapshot().pendingCount).toBe(0);
    stopFresh();
  });
});
