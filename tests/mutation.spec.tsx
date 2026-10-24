import type { ConnectionSnapshot, Enbox } from '@enbox/browser';

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxBindingChangedError, EnboxNotConnectedError, EnboxProvider, useEnboxMutation } from '../src/index.js';
import { EnboxMutationObserver } from '../src/internal/mutation-observer.js';
import { connected, controlledClient, deferred, facade, subscribeObserver } from './helpers.js';

describe('session-bound mutations', () => {
  it('awaits a typed success handler once and keeps progress until it settles', async () => {
    const { client } = controlledClient(connected());
    const handler = deferred<void>();
    const onSuccess = vi.fn(async (_result: string, _variables: { title: string }) => handler.promise);
    const operation = vi.fn(async (_enbox: Enbox, variables: { title: string }) => variables.title);
    const hook = renderHook(() => useEnboxMutation(operation), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    const variables = { title: 'Saved' };
    act(() => hook.result.current.mutate(variables, { onSuccess }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Saved', variables));
    expect(hook.result.current.isPending).toBe(true);
    await act(async () => { handler.resolve(); await handler.promise; });
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
    expect(operation).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.run).toBe(hook.result.current.mutateAsync);
  });

  it('surfaces success-handler failures without retrying an already committed operation', async () => {
    const { client } = controlledClient(connected());
    const error = new Error('UI handler failed');
    const operation = vi.fn(async () => 'committed');
    const hook = renderHook(() => useEnboxMutation(operation), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(undefined, { onSuccess: () => { throw error; } })).rejects.toBe(error);
    });
    expect(hook.result.current.error).toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('captures the invoking handler and skips it when the parent scope is replaced', async () => {
    const { client } = controlledClient(connected());
    const write = deferred<string>();
    const firstHandler = vi.fn();
    const replacementHandler = vi.fn();
    const options = { onSuccess: firstHandler };
    const hook = renderHook(({ scope }) => useEnboxMutation(async () => write.promise, { scope }), {
      initialProps: { scope: 'first' },
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    let issued!: Promise<string>;
    act(() => { issued = hook.result.current.mutateAsync(undefined, options); });
    options.onSuccess = replacementHandler;
    hook.rerender({ scope: 'next' });
    await act(async () => { write.resolve('saved'); expect(await issued).toBe('saved'); });
    expect(firstHandler).not.toHaveBeenCalled();
    expect(replacementHandler).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBeUndefined();
  });

  it('uses the handler supplied by the invocation even if its options object is later changed', async () => {
    const { client } = controlledClient(connected());
    const write = deferred<string>();
    const original = vi.fn();
    const replacement = vi.fn();
    const options = { onSuccess: original };
    const hook = renderHook(() => useEnboxMutation(async () => write.promise), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    let issued!: Promise<string>;
    act(() => { issued = hook.result.current.mutateAsync(undefined, options); });
    options.onSuccess = replacement;
    await act(async () => { write.resolve('saved'); await issued; });
    expect(original).toHaveBeenCalledWith('saved', undefined);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('rejects invalid success handlers before writing and publishes option failures in state', async () => {
    const { client } = controlledClient(connected());
    const operation = vi.fn(async () => 'saved');
    const hook = renderHook(() => useEnboxMutation(operation), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(undefined, { onSuccess: null } as never)).rejects.toThrow('must be a function');
    });
    expect(hook.result.current.error).toBeInstanceOf(TypeError);
    const failure = new Error('Callback options failed');
    const options = { get onSuccess(): never { throw failure; } };
    act(() => hook.result.current.mutate(undefined, options));
    await waitFor(() => expect(hook.result.current.error).toBe(failure));
    expect(operation).not.toHaveBeenCalled();
  });

  it('keeps native rejection causes and does not invoke a success handler after failure', async () => {
    const { client } = controlledClient(connected());
    const error = { native: 'failure' };
    const onSuccess = vi.fn();
    const hook = renderHook(() => useEnboxMutation(async () => { throw error; }), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(undefined, { onSuccess })).rejects.toBe(error);
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(hook.result.current.error?.cause).toBe(error);
  });

  it('publishes immutable typed variables for concurrent calls and removes only settled calls', async () => {
    const initial = connected();
    const { client } = controlledClient(initial);
    const observer = new EnboxMutationObserver<{ recipient: string }>(client, initial);
    const stop = subscribeObserver(observer);
    const first = deferred<string>();
    const second = deferred<string>();
    const third = deferred<string>();
    const recipient = { recipient: 'alice' };
    const otherRecipient = { recipient: 'bob' };
    const firstRun = observer.run(async () => first.promise, recipient);
    const secondRun = observer.run(async () => second.promise, otherRecipient);
    const thirdRun = observer.run(async () => third.promise, recipient);
    const both = observer.getSnapshot().pendingVariables;
    expect(both).toEqual([recipient, otherRecipient, recipient]);
    expect(Object.isFrozen(both)).toBe(true);
    observer.reset();
    expect(observer.getSnapshot().pendingVariables).toBe(both);
    second.resolve('second saved');
    expect(await secondRun).toBe('second saved');
    expect(observer.getSnapshot().pendingVariables).toEqual([recipient, recipient]);
    expect(both).toEqual([recipient, otherRecipient, recipient]);
    first.resolve('first saved');
    expect(await firstRun).toBe('first saved');
    expect(observer.getSnapshot().pendingVariables).toEqual([recipient]);
    third.resolve('third saved');
    expect(await thirdRun).toBe('third saved');
    expect(observer.getSnapshot().pendingVariables).toEqual([]);
    stop();
  });

  it('retires a changed caller scope while preserving issued outcomes and new scope state', async () => {
    const { client } = controlledClient(connected());
    const oldWrite = deferred<string>();
    const newWrite = deferred<string>();
    const operation = vi.fn().mockImplementationOnce(() => oldWrite.promise)
      .mockImplementationOnce(() => newWrite.promise);
    const hook = renderHook(({ scope }) => useEnboxMutation<string, string>(operation, { scope }), {
      initialProps: { scope: 'first-page' },
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    const captured = hook.result.current;
    let oldRun!: Promise<string>;
    act(() => { oldRun = captured.run('old'); });
    hook.rerender({ scope: 'next-page' });
    expect(captured.isCurrent()).toBe(false);
    expect(hook.result.current.pendingVariables).toEqual([]);
    await expect(captured.run('stale')).rejects.toBeInstanceOf(EnboxBindingChangedError);
    let newRun!: Promise<string>;
    act(() => { newRun = hook.result.current.run('new'); });
    const failure = new Error('new scope failed');
    await act(async () => { newWrite.reject(failure); await expect(newRun).rejects.toBe(failure); });
    await act(async () => { oldWrite.resolve('old saved'); expect(await oldRun).toBe('old saved'); });
    expect(hook.result.current.error).toBe(failure);
    expect(hook.result.current.pendingVariables).toEqual([]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('keeps pending work when callbacks and options rerender with the same scope', async () => {
    const { client } = controlledClient(connected());
    const write = deferred<string>();
    const hook = renderHook(({ label }) => useEnboxMutation(
      async (_enbox, variables: string) => { void label; return write.promise.then(() => variables); },
      { scope: 'same-page' },
    ), {
      initialProps: { label: 'before' },
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    let issued!: Promise<string>;
    act(() => { issued = hook.result.current.run('draft'); });
    const variables = hook.result.current.pendingVariables;
    hook.rerender({ label: 'after' });
    expect(hook.result.current.pendingVariables).toBe(variables);
    expect(hook.result.current.isPending).toBe(true);
    await act(async () => { write.resolve('saved'); expect(await issued).toBe('draft'); });
    expect(hook.result.current.pendingVariables).toEqual([]);
  });

  it('lets callers guard UI effects after an issued write outlives its session', async () => {
    const initial = connected();
    const { client, publish } = controlledClient(initial);
    const writing = deferred<string>();
    const hook = renderHook(() => useEnboxMutation(async () => writing.promise), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    const captured = hook.result.current;
    expect(captured.isCurrent()).toBe(true);
    let issued!: Promise<string>;
    act(() => { issued = captured.run(undefined); });
    act(() => publish(connected(facade(), 'did:example:bob')));
    expect(captured.isCurrent()).toBe(false);
    await act(async () => { writing.resolve('saved'); await issued; });
    expect(captured.isCurrent()).toBe(false);
    expect(hook.result.current.isCurrent()).toBe(true);
    hook.unmount();
    expect(hook.result.current.isCurrent()).toBe(false);
  });
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

  it('keeps a replacement subscription active when native cleanup resubscribes synchronously', async () => {
    const initial = connected();
    const { client, listeners } = controlledClient(initial);
    const write = deferred<string>();
    let pending!: Promise<string>;
    let observer!: EnboxMutationObserver<void>;
    let releaseReplacement = (): void => {};
    let replaceOnCleanup = true;
    const store = {
      ...client,
      subscribe: (notify: (snapshot: ConnectionSnapshot) => void) => {
        const unsubscribe = client.subscribe(notify);
        return () => {
          unsubscribe();
          if (replaceOnCleanup) {
            replaceOnCleanup = false;
            releaseReplacement = observer.subscribe(() => {});
            pending = observer.run(async () => write.promise, undefined);
          }
        };
      },
    };
    observer = new EnboxMutationObserver<void>(store, initial);
    const release = observer.subscribe(() => {});
    try {
      release();
      expect(observer.isCurrent()).toBe(true);
      expect(listeners.size).toBe(1);
      expect(observer.getSnapshot().pendingCount).toBe(1);
      expect(observer.getSnapshot().pendingVariables).toEqual([undefined]);
      write.resolve('saved');
      await expect(pending).resolves.toBe('saved');
      expect(observer.getSnapshot().pendingCount).toBe(0);
    } finally {
      write.resolve('saved');
      await pending;
      release();
      releaseReplacement();
    }
    expect(observer.isCurrent()).toBe(false);
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
