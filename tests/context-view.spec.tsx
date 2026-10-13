import type { ContextView, ContextViewState } from '@enbox/browser';

import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { startTransition, Suspense, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createContextStore } from '../src/config/context-store.js';
import { EnboxBindingChangedError } from '../src/errors.js';
import { useContextView, type ContextViewOpener } from '../src/hooks/context-view.js';
import { ContextViewObserver } from '../src/internal/context-view-observer.js';
import { deferred, subscribeObserver } from './helpers.js';

class ControlledContextView<Context> implements ContextView<Context> {
  private _state: ContextViewState<Context>;
  public readonly listeners = new Set<(state: ContextViewState<Context>) => void>();
  public readonly close = vi.fn(async (): Promise<void> => { this.listeners.clear(); });
  public onSubscribe: (() => void) | undefined;

  public constructor(contexts: readonly Context[] = []) {
    this._state = Object.freeze({ status: 'ready', contexts: Object.freeze([...contexts]) });
  }

  public readonly getSnapshot = (): ContextViewState<Context> => this._state;
  public readonly subscribe = (notify: (state: ContextViewState<Context>) => void): (() => void) => {
    this.onSubscribe?.();
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  };

  public async ready(): Promise<Extract<ContextViewState<Context>, { status: 'ready' }>> {
    if (this._state.status !== 'ready') throw new Error('Test catalog is not ready.');
    return this._state;
  }

  public publish(state: ContextViewState<Context>): void {
    this._state = Object.freeze(state);
    for (const notify of this.listeners) notify(this._state);
  }
}

describe('owned context views', () => {
  it('opens after subscription and preserves native loading, ready, and error snapshots', async () => {
    const view = new ControlledContextView(['saved']);
    view.publish({ status: 'loading', contexts: [] });
    const open = vi.fn(async () => view);
    const observer = new ContextViewObserver(open);
    expect(open).not.toHaveBeenCalled();
    expect(observer.getSnapshot()).toBe(observer.getSnapshot());
    expect(observer.getServerSnapshot()).toMatchObject({ status: 'idle', contexts: [] });
    const stop = subscribeObserver(observer);
    await observer.retry();
    expect(observer.getSnapshot().status).toBe('loading');
    view.publish({ status: 'ready', contexts: ['saved'] });
    expect(observer.getSnapshot()).toMatchObject({ status: 'ready', contexts: ['saved'] });
    const failure = new Error('context observation failed');
    view.publish({ status: 'error', contexts: ['saved'], error: failure });
    expect(observer.getSnapshot()).toMatchObject({ status: 'error', contexts: ['saved'], error: failure });
    expect(observer.getSnapshot()).not.toHaveProperty('current');
    expect(observer.getSnapshot()).not.toHaveProperty('hasMore');
    expect(observer.getSnapshot()).not.toHaveProperty('isLoadingMore');
    stop();
    expect(view.close).toHaveBeenCalledOnce();
    await expect(observer.retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
  });

  it('survives Strict Mode replay and aborts every acquired view on unmount', async () => {
    const views: ControlledContextView<string>[] = [];
    const signals: AbortSignal[] = [];
    const open = async (signal: AbortSignal) => {
      signals.push(signal);
      const view = new ControlledContextView(['live']);
      views.push(view);
      return view;
    };
    const hook = renderHook(() => useContextView(open), { reactStrictMode: true });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(views.filter((view) => view.close.mock.calls.length === 0)).toHaveLength(1);
    hook.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(views.every((view) => view.close.mock.calls.length === 1)).toBe(true);
  });

  it('renders an idle server shell and hydrates the owner store without reopening it', async () => {
    const view = new ControlledContextView(['saved']);
    const open = vi.fn(async () => view);
    const store = createContextStore(open);
    await store.ready();
    function Content() {
      const state = useContextView(store);
      return <output>{state.status}:{state.contexts.join(',')}</output>;
    }
    const html = renderToString(<Content />);
    expect(html).toContain('idle');
    expect(html).not.toContain('saved');
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = html;
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, <Content />, { onRecoverableError: recoverable }); });
      expect(container.textContent).toBe('ready:saved');
      expect(open).toHaveBeenCalledOnce();
      expect(recoverable).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      await store.close();
    }
    const inertOpen = vi.fn(async () => new ControlledContextView(['unused']));
    function Inert() { return <output>{useContextView(inertOpen).status}</output>; }
    expect(renderToString(<Inert />)).toContain('idle');
    expect(inertOpen).not.toHaveBeenCalled();
  });

  it('does not open a suspended replacement or retire committed UI', async () => {
    const view = new ControlledContextView(['A']);
    const first = vi.fn(async () => view);
    const second = vi.fn(async () => new ControlledContextView(['B']));
    const suspended = new Promise<never>(() => {});
    function Pane({ selected }: { selected: string }) {
      const state = useContextView(selected === 'A' ? first : second);
      if (selected === 'B') throw suspended;
      return <output>{state.contexts.join(',')}</output>;
    }
    function App() {
      const [selected, setSelected] = useState('A');
      return <>
        <button onClick={() => startTransition(() => setSelected('B'))}>Change</button>
        <Suspense fallback={<p>Waiting</p>}><Pane selected={selected} /></Suspense>
      </>;
    }
    const tree = render(<App />);
    await waitFor(() => expect(tree.getByText('A')).toBeDefined());
    act(() => { fireEvent.click(tree.getByText('Change')); });
    expect(second).not.toHaveBeenCalled();
    expect(view.close).not.toHaveBeenCalled();
    tree.unmount();
    expect(view.close).toHaveBeenCalledOnce();
  });

  it('closes a late obsolete catalog and fences retained controls after disabling', async () => {
    const opening = deferred<ContextView<string>>();
    const first = vi.fn(() => opening.promise);
    const late = new ControlledContextView(['obsolete']);
    const live = new ControlledContextView(['current']);
    const second = async () => live;
    const hook = renderHook(({ opener }: { opener: ContextViewOpener<string> | null }) => useContextView(opener), {
      initialProps: { opener: first as ContextViewOpener<string> | null },
    });
    await waitFor(() => expect(first).toHaveBeenCalledOnce());
    hook.rerender({ opener: second });
    await waitFor(() => expect(hook.result.current.contexts).toEqual(['current']));
    await act(async () => { opening.resolve(late); });
    expect(late.close).toHaveBeenCalledOnce();
    expect(hook.result.current.contexts).toEqual(['current']);
    const retry = hook.result.current.retry;
    hook.rerender({ opener: null });
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.contexts).toEqual([]);
    expect(live.close).toHaveBeenCalledOnce();
    await expect(retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
  });

  it('publishes opening errors and coalesces explicit recovery retries', async () => {
    const failure = new Error('catalog failed');
    const recovered = deferred<ContextView<string>>();
    const view = new ControlledContextView(['recovered']);
    const open = vi.fn<ContextViewOpener<string>>().mockRejectedValueOnce(failure).mockImplementation(() => recovered.promise);
    const hook = renderHook(() => useContextView(open));
    await waitFor(() => expect(hook.result.current.error).toBe(failure));
    let retry!: Promise<void>;
    act(() => {
      retry = hook.result.current.retry();
      expect(hook.result.current.retry()).toBe(retry);
    });
    await act(async () => { recovered.resolve(view); await retry; });
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.contexts).toEqual(['recovered']);
    expect(hook.result.current.error).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps original explicit rejections while safely displaying unknown errors', async () => {
    const failure: unknown = Object.create(null);
    const observer = new ContextViewObserver<string>(async () => { throw failure; });
    const stop = subscribeObserver(observer);
    await expect(observer.retry()).rejects.toBe(failure);
    expect(observer.getSnapshot().status).toBe('error');
    expect(observer.getSnapshot().error).toBeInstanceOf(Error);
    expect(observer.getSnapshot().error?.cause).toBe(failure);
    stop();
  });

  it('registers replacement retries before abort cleanup and loading notifications', async () => {
    const views: ControlledContextView<string>[] = [];
    let abortRetry: Promise<void> | undefined;
    let loadingRetry: Promise<void> | undefined;
    let observer!: ContextViewObserver<string>;
    const open = vi.fn(async (signal: AbortSignal) => {
      const view = new ControlledContextView(['live']);
      views.push(view);
      if (views.length === 1) signal.addEventListener('abort', () => { abortRetry = observer.retry(); }, { once: true });
      return view;
    });
    observer = new ContextViewObserver(open);
    const stop = subscribeObserver(observer);
    await observer.retry();
    const stopLoading = subscribeObserver(observer, () => {
      if (observer.getSnapshot().status === 'loading' && loadingRetry === undefined) loadingRetry = observer.retry();
    });
    const retry = observer.retry();
    expect(abortRetry).toBe(retry);
    expect(loadingRetry).toBe(retry);
    await retry;
    expect(open).toHaveBeenCalledTimes(2);
    stopLoading();
    stop();
    expect(views.every((view) => view.close.mock.calls.length === 1)).toBe(true);
  });

  it('keeps replacement readiness pending when an opening failure retries during cleanup', async () => {
    const failedOpening = deferred<ContextView<string>>();
    const replacementOpening = deferred<ContextView<string>>();
    let recovered!: Promise<void>;
    let ready!: Promise<Extract<ReturnType<ContextViewObserver<string>['getSnapshot']>, { status: 'ready' }>>;
    let readySettled = false;
    let store!: ReturnType<typeof createContextStore<string>>;
    const open = vi.fn<ContextViewOpener<string>>().mockImplementationOnce((signal) => {
      signal.addEventListener('abort', () => {
        recovered = store.retry();
        ready = store.ready();
        void ready.then(() => { readySettled = true; }, () => { readySettled = true; });
      }, { once: true });
      return failedOpening.promise;
    }).mockImplementation(() => replacementOpening.promise);
    store = createContextStore(open);
    const stop = subscribeObserver(store);
    const opening = store.retry();
    await Promise.resolve();
    const failure = new Error('catalog opening failed');
    const rejected = expect(opening).rejects.toBe(failure);
    failedOpening.reject(failure);
    await rejected;
    expect(open).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().status).toBe('loading');
    expect(readySettled).toBe(false);
    const replacement = new ControlledContextView(['recovered']);
    replacementOpening.resolve(replacement);
    await recovered;
    await expect(ready).resolves.toMatchObject({ contexts: ['recovered'] });
    stop();
    await store.close();
    expect(replacement.close).toHaveBeenCalledOnce();
  });

  it('releases a subscription returned after its binding was invalidated during attachment', async () => {
    let current = true;
    let notifyBinding = (): void => {};
    const view = new ControlledContextView(['private']);
    view.onSubscribe = () => { current = false; notifyBinding(); };
    const observer = new ContextViewObserver(async () => view, {
      isCurrent: () => current,
      subscribe: (notify) => { notifyBinding = notify; return () => {}; },
    });
    const stop = subscribeObserver(observer);
    await observer.retry();
    expect(observer.getSnapshot().status).toBe('idle');
    expect(view.listeners.size).toBe(0);
    expect(view.close).toHaveBeenCalledOnce();
    await expect(observer.retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    stop();
  });

  it('reads changes made during subscription attachment and caches identical snapshots', async () => {
    const view = new ControlledContextView(['first']);
    view.onSubscribe = () => view.publish({ status: 'ready', contexts: ['changed'] });
    const observer = new ContextViewObserver(async () => view);
    const stop = subscribeObserver(observer);
    await observer.retry();
    expect(observer.getSnapshot().contexts).toEqual(['changed']);
    expect(observer.getSnapshot()).toBe(observer.getSnapshot());
    stop();
  });

  it.each(['subscribe', 'getSnapshot'] as const)('closes an acquired catalog when %s throws', async (method) => {
    const failure = new Error('attachment failed');
    const view = new ControlledContextView(['private']);
    vi.spyOn(view, method).mockImplementation(() => { throw failure; });
    const observer = new ContextViewObserver(async () => view);
    const stop = subscribeObserver(observer);
    await expect(observer.retry()).rejects.toBe(failure);
    expect(observer.getSnapshot().error).toBe(failure);
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.listeners.size).toBe(0);
    stop();
  });

  it.each(['synchronous', 'asynchronous'] as const)('reports %s cleanup failures and still settles owner cleanup', async (mode) => {
    const bindingFailure = new Error('binding cleanup failed');
    const subscriptionFailure = new Error('subscription cleanup failed');
    const closeFailure = new Error('catalog close failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = new ControlledContextView(['saved']);
    let signal: AbortSignal | undefined;
    vi.spyOn(view, 'subscribe').mockImplementation(() => () => { throw subscriptionFailure; });
    if (mode === 'synchronous') view.close.mockImplementation(() => { throw closeFailure; });
    else view.close.mockRejectedValue(closeFailure);
    const observer = new ContextViewObserver(async (openingSignal) => { signal = openingSignal; return view; }, {
      isCurrent: () => true, subscribe: () => () => { throw bindingFailure; },
    });
    const stop = subscribeObserver(observer);
    try {
      await observer.retry();
      await observer.close();
      expect(signal?.aborted).toBe(true);
      expect(view.close).toHaveBeenCalledOnce();
      for (const failure of [bindingFailure, subscriptionFailure, closeFailure]) {
        expect(warn).toHaveBeenCalledWith('[@enbox/react] Resource cleanup failed.', failure);
      }
    } finally { stop(); warn.mockRestore(); }
  });
});

describe('shared context catalogs', () => {
  it('shares one catalog with controllers and React until its owner retires it', async () => {
    const view = new ControlledContextView(['first']);
    const open = vi.fn(async () => view);
    const store = createContextStore(open);
    expect(open).not.toHaveBeenCalled();
    const controller = vi.fn();
    const release = store.subscribe(controller);
    const first = renderHook(() => useContextView(store));
    const second = renderHook(() => useContextView(store));
    await store.ready();
    await waitFor(() => expect(first.result.current.contexts).toEqual(['first']));
    expect(second.result.current.contexts).toEqual(['first']);
    expect(open).toHaveBeenCalledOnce();
    act(() => view.publish({ status: 'ready', contexts: ['second'] }));
    expect(first.result.current.contexts).toEqual(['second']);
    expect(second.result.current.contexts).toEqual(['second']);
    expect(controller).toHaveBeenCalled();
    first.unmount(); second.unmount(); release();
    expect(view.close).not.toHaveBeenCalled();
    expect(store.getSnapshot().contexts).toEqual(['second']);
    await store.close();
    await store.close();
    expect(view.close).toHaveBeenCalledOnce();
    expect(store.getSnapshot().status).toBe('idle');
    await expect(store.ready()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await expect(store.retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
  });

  it('cancels one readiness waiter while retaining the owner catalog for others', async () => {
    const view = new ControlledContextView<string>();
    view.publish({ status: 'loading', contexts: [] });
    const store = createContextStore(async () => view);
    const waiter = new AbortController();
    const ready = store.ready({ signal: waiter.signal });
    const reason = new Error('waiter cancelled');
    const rejection = expect(ready).rejects.toBe(reason);
    waiter.abort(reason);
    await rejection;
    const remaining = store.ready();
    await waitFor(() => expect(view.listeners.size).toBe(1));
    view.publish({ status: 'ready', contexts: ['retained'] });
    await expect(remaining).resolves.toMatchObject({ contexts: ['retained'] });
    expect(view.close).not.toHaveBeenCalled();
    await store.close();
  });

  it('waits for acquired view cleanup when the owner closes', async () => {
    const view = new ControlledContextView(['saved']);
    const cleanup = deferred<void>();
    view.close.mockImplementation(() => cleanup.promise);
    const store = createContextStore(async () => view);
    await store.ready();
    let closed = false;
    const closing = store.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    cleanup.resolve();
    await closing;
    expect(closed).toBe(true);
  });

  it('rejects readiness on owner close and releases a late opening when it settles', async () => {
    const opening = deferred<ContextView<string>>();
    const store = createContextStore(() => opening.promise);
    const ready = store.ready();
    const rejected = expect(ready).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await Promise.resolve();
    await store.close();
    await rejected;
    const late = new ControlledContextView(['late']);
    opening.resolve(late);
    await waitFor(() => expect(late.close).toHaveBeenCalledOnce());
    expect(store.getSnapshot().status).toBe('idle');
  });

  it('releases owner-aborted catalogs immediately and rejects retained controls', async () => {
    const view = new ControlledContextView(['private']);
    const lifetime = new AbortController();
    const store = createContextStore(async () => view, { signal: lifetime.signal });
    const hook = renderHook(() => useContextView(store));
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    const retry = hook.result.current.retry;
    act(() => lifetime.abort());
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.contexts).toEqual([]);
    expect(view.close).toHaveBeenCalledOnce();
    await expect(store.ready()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await expect(retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    hook.unmount();
    await store.close();
  });

  it('rejects owner-aborted readiness and closes a later acquired catalog', async () => {
    const opening = deferred<ContextView<string>>();
    const lifetime = new AbortController();
    const open = vi.fn(() => opening.promise);
    const store = createContextStore(open, { signal: lifetime.signal });
    const ready = store.ready();
    const rejection = expect(ready).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    lifetime.abort();
    await rejection;
    const late = new ControlledContextView(['private']);
    opening.resolve(late);
    await waitFor(() => expect(late.close).toHaveBeenCalledOnce());
    expect(store.getSnapshot().contexts).toEqual([]);
    await store.close();
  });

  it('never opens catalogs for an already-ended owner or a disabled opener', async () => {
    const lifetime = new AbortController();
    lifetime.abort();
    const open = vi.fn(async () => new ControlledContextView(['unused']));
    const store = createContextStore(open, { signal: lifetime.signal });
    await expect(store.ready()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(open).not.toHaveBeenCalled();
    const disabled = createContextStore<string>(null);
    await expect(disabled.ready()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await store.close();
    await disabled.close();
  });
});
