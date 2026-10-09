import { Activity } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RecordViewOpener } from '../src/index.js';

import { useRecordView } from '../src/index.js';
import { EnboxBindingChangedError } from '../src/errors.js';
import { RecordViewObserver } from '../src/internal/record-view-observer.js';
import { ControlledView, deferred, subscribeObserver } from './helpers.js';

describe('record view binding', () => {
  it('still aborts and closes its view when binding cleanup throws', async () => {
    const failure = new Error('binding cleanup failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = new ControlledView(['saved']);
    let signal: AbortSignal | undefined;
    const observer = new RecordViewObserver(async (openingSignal) => {
      signal = openingSignal;
      return view;
    }, {
      isCurrent: () => true,
      subscribe: () => () => { throw failure; },
    });
    const stop = subscribeObserver(observer);
    try {
      await observer.retry();
      expect(stop).not.toThrow();
      expect(signal?.aborted).toBe(true);
      expect(view.close).toHaveBeenCalledOnce();
      expect(view.listeners.size).toBe(0);
      expect(warn).toHaveBeenCalledWith('[@enbox/react] Resource cleanup failed.', failure);
    } finally {
      stop();
      warn.mockRestore();
    }
  });

  it('reports subscription and close failures while completing the remaining cleanup', async () => {
    const unsubscribeFailure = new Error('subscription cleanup failed');
    const closeFailure = new Error('close failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = new ControlledView(['saved']);
    vi.spyOn(view, 'subscribe').mockImplementation(() => () => { throw unsubscribeFailure; });
    view.close.mockRejectedValue(closeFailure);
    const observer = new RecordViewObserver(async () => view);
    const stop = subscribeObserver(observer);
    try {
      await observer.retry();
      expect(stop).not.toThrow();
      await Promise.resolve();
      expect(view.close).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('[@enbox/react] Resource cleanup failed.', unsubscribeFailure);
      expect(warn).toHaveBeenCalledWith('[@enbox/react] Resource cleanup failed.', closeFailure);
      await expect(observer.retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    } finally {
      stop();
      warn.mockRestore();
    }
  });

  it('rejects a failed explicit retry while keeping the failure in state', async () => {
    const failure = new Error('opening failed');
    const opener = vi.fn(async (): Promise<ControlledView<string>> => { throw failure; });
    const hook = renderHook(() => useRecordView(opener));
    await waitFor(() => expect(hook.result.current.error).toBe(failure));
    await act(async () => {
      await expect(hook.result.current.retry()).rejects.toBe(failure);
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.error).toBe(failure);
    expect(opener).toHaveBeenCalledTimes(2);
  });

  it('coalesces a retry requested during abort cleanup without leaking a view', async () => {
    const views: ControlledView<string>[] = [];
    const signals: AbortSignal[] = [];
    let reentrant: Promise<void> | undefined;
    let observer!: RecordViewObserver<string>;
    const opener = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal);
      const view = new ControlledView(['live']);
      views.push(view);
      if (views.length === 1) {
        signal.addEventListener('abort', () => { reentrant = observer.retry(); }, { once: true });
      }
      return view;
    });
    observer = new RecordViewObserver(opener);
    const stop = subscribeObserver(observer);
    try {
      await observer.retry();
      const retry = observer.retry();
      await retry;
      expect(reentrant).toBe(retry);
      expect(opener).toHaveBeenCalledTimes(2);
      expect(views[0]?.close).toHaveBeenCalledOnce();
    } finally {
      stop();
      await Promise.allSettled([reentrant]);
    }
    expect(views.every((view) => view.close.mock.calls.length === 1)).toBe(true);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('owns one view until the last subscriber leaves and reopens on resubscription', async () => {
    const views: ControlledView<string>[] = [];
    const opener = vi.fn(async () => {
      const view = new ControlledView(['live']);
      views.push(view);
      return view;
    });
    const observer = new RecordViewObserver(opener);
    expect(observer.getSnapshot()).toBe(observer.getSnapshot());
    expect(opener).not.toHaveBeenCalled();
    const notify = vi.fn();
    const first = subscribeObserver(observer, notify);
    const second = subscribeObserver(observer, notify);
    await waitFor(() => expect(observer.getSnapshot().status).toBe('ready'));
    expect(opener).toHaveBeenCalledOnce();
    first();
    first();
    expect(views[0]?.close).not.toHaveBeenCalled();
    second();
    expect(views[0]?.close).toHaveBeenCalledOnce();
    expect(views[0]?.listeners.size).toBe(0);
    await expect(observer.retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    const replacement = subscribeObserver(observer, notify);
    first();
    second();
    try {
      await waitFor(() => expect(opener).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(observer.getSnapshot().status).toBe('ready'));
      expect(views[1]?.close).not.toHaveBeenCalled();
    } finally {
      replacement();
    }
    expect(views[1]?.close).toHaveBeenCalledOnce();
  });

  it('removes a listener returned after the binding changed during subscription', async () => {
    let current = true;
    let notifyBinding = (): void => {};
    const view = new ControlledView(['private']);
    view.onSubscribe = () => { current = false; notifyBinding(); };
    const observer = new RecordViewObserver(async () => view, {
      isCurrent: () => current,
      subscribe: (notify) => { notifyBinding = notify; return () => {}; },
    });
    const stop = subscribeObserver(observer);
    try {
      await observer.retry();
      expect(observer.getSnapshot().status).toBe('idle');
      expect(view.close).toHaveBeenCalledOnce();
      expect(view.listeners.size).toBe(0);
    } finally {
      stop();
    }
  });

  it('coalesces retries requested by a loading-state subscriber', async () => {
    const initial = new ControlledView(['initial']);
    const replacement = new ControlledView(['replacement']);
    const opener = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(replacement);
    const observer = new RecordViewObserver<string>(opener);
    const stop = subscribeObserver(observer);
    await observer.retry();
    let reentrant: Promise<void> | undefined;
    const unsubscribe = subscribeObserver(observer, () => {
      if (observer.getSnapshot().status === 'loading' && reentrant === undefined) {
        reentrant = observer.retry();
      }
    });
    const first = observer.retry();
    try {
      expect(reentrant).toBe(first);
      await first;
      expect(opener).toHaveBeenCalledTimes(2);
      expect(observer.getSnapshot().records).toEqual(['replacement']);
    } finally {
      unsubscribe();
      await Promise.allSettled([first, reentrant]);
      stop();
    }
  });

  it('tracks pagination before notifying reentrant subscribers', async () => {
    const page = deferred<void>();
    const view = new ControlledView(['first']);
    view.loadMore.mockImplementation(() => page.promise);
    const observer = new RecordViewObserver(async () => view);
    const stop = subscribeObserver(observer);
    await observer.retry();
    let reentrant: Promise<void> | undefined;
    const unsubscribe = subscribeObserver(observer, () => {
      if (observer.getSnapshot().isLoadingMore && reentrant === undefined) {
        reentrant = observer.loadMore();
      }
    });
    const first = observer.loadMore();
    try {
      expect(reentrant).toBe(first);
      await Promise.resolve();
      expect(view.loadMore).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
      page.resolve();
      await Promise.allSettled([first, reentrant]);
      stop();
    }
  });

  it('preserves rows after pagination failure and clears the error on retry', async () => {
    const failure = new Error('page failed');
    const first = new ControlledView(['saved']);
    const replacement = new ControlledView(['recovered']);
    first.loadMore.mockRejectedValue(failure);
    const opener = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(replacement);
    const observer = new RecordViewObserver<string>(opener);
    const stop = subscribeObserver(observer);
    try {
      await observer.retry();
      const savedRows = observer.getSnapshot().records;
      await expect(observer.loadMore()).rejects.toBe(failure);
      expect(observer.getSnapshot()).toMatchObject({
        status: 'error', error: failure, current: false, isLoadingMore: false,
      });
      expect(observer.getSnapshot().records).toBe(savedRows);
      await observer.retry();
      expect(observer.getSnapshot().status).toBe('ready');
      expect(observer.getSnapshot().error).toBeUndefined();
      expect(observer.getSnapshot().records).toEqual(['recovered']);
      expect(first.close).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

  it('rejects pagination retired by a pending-state subscriber before calling the view', async () => {
    let current = true;
    let notifyBinding = (): void => {};
    const view = new ControlledView(['saved']);
    const observer = new RecordViewObserver(async () => view, {
      isCurrent: () => current,
      subscribe: (notify) => { notifyBinding = notify; return () => {}; },
    });
    const stop = subscribeObserver(observer);
    await observer.retry();
    const unsubscribe = subscribeObserver(observer, () => {
      if (observer.getSnapshot().isLoadingMore) {
        current = false;
        notifyBinding();
      }
    });
    try {
      await expect(observer.loadMore()).rejects.toBeInstanceOf(EnboxBindingChangedError);
      expect(view.loadMore).not.toHaveBeenCalled();
      expect(view.close).toHaveBeenCalledOnce();
      expect(observer.getSnapshot().status).toBe('idle');
    } finally {
      unsubscribe();
      stop();
    }
  });

  it.each(['subscribe', 'getSnapshot'] as const)('closes a view when its %s fails during attachment', async (method) => {
    const failure = new Error('attachment failed');
    const view = new ControlledView(['private']);
    vi.spyOn(view, method).mockImplementation(() => { throw failure; });
    const observer = new RecordViewObserver(async () => view);
    const stop = subscribeObserver(observer);
    try {
      await expect(observer.retry()).rejects.toBe(failure);
      expect(observer.getSnapshot().error).toBe(failure);
      expect(view.close).toHaveBeenCalledOnce();
      expect(view.listeners.size).toBe(0);
    } finally {
      stop();
    }
  });

  it('closes an obsolete late opening and keeps the newer selection', async () => {
    const opening = deferred<ControlledView<string>>();
    const oldView = new ControlledView(['old']);
    const newView = new ControlledView(['new']);
    const first: RecordViewOpener<string> = vi.fn(() => opening.promise);
    const second = async () => newView;
    const hook = renderHook(
      ({ opener }: { opener: RecordViewOpener<string> }) => useRecordView(opener),
      { initialProps: { opener: first } },
    );
    await waitFor(() => expect(first).toHaveBeenCalledOnce());
    hook.rerender({ opener: second });
    await waitFor(() => expect(hook.result.current.records).toEqual(['new']));
    await act(async () => opening.resolve(oldView));
    expect(oldView.close).toHaveBeenCalledOnce();
    expect(hook.result.current.records).toEqual(['new']);
    hook.unmount();
    expect(newView.close).toHaveBeenCalledOnce();
    expect(newView.listeners.size).toBe(0);
  });

  it('reads again after subscription attachment and keeps cached snapshots', async () => {
    const view = new ControlledView(['first']);
    view.onSubscribe = () => view.publish({ status: 'ready', records: ['changed'], hasMore: false, current: false });
    const observer = new RecordViewObserver(async () => view);
    const stop = subscribeObserver(observer);
    await observer.retry();
    expect(observer.getSnapshot().records).toEqual(['changed']);
    expect(observer.getSnapshot().current).toBe(false);
    expect(observer.getSnapshot()).toBe(observer.getSnapshot());
    stop();
  });

  it('survives Strict Mode opening replay', async () => {
    const views: ControlledView<string>[] = [];
    const signals: AbortSignal[] = [];
    const opener = async (signal: AbortSignal) => {
      signals.push(signal);
      const view = new ControlledView(['live']);
      views.push(view);
      return view;
    };
    const hook = renderHook(() => useRecordView(opener), {
      reactStrictMode: true,
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(views.filter((view) => view.close.mock.calls.length === 0)).toHaveLength(1);
    hook.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(views.every((view) => view.close.mock.calls.length === 1)).toBe(true);
  });

  it('reopens after Activity hides and restores retained state', async () => {
    const views: ControlledView<string>[] = [];
    const opener = async () => {
      const view = new ControlledView(['visible']);
      views.push(view);
      return view;
    };
    function Content() {
      const snapshot = useRecordView(opener);
      return <output>{snapshot.status}</output>;
    }
    const tree = render(<Activity mode="visible"><Content /></Activity>);
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    tree.rerender(<Activity mode="hidden"><Content /></Activity>);
    expect(views[0]?.close).toHaveBeenCalledOnce();
    tree.rerender(<Activity mode="visible"><Content /></Activity>);
    await waitFor(() => expect(views.length).toBe(2));
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    expect(views[1]?.close).not.toHaveBeenCalled();
    tree.unmount();
    expect(views.every((view) => view.close.mock.calls.length === 1)).toBe(true);
  });

  it('turns opening failures into state and supports explicit retry', async () => {
    const failure = new Error('opening failed');
    const view = new ControlledView(['recovered']);
    const opener = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(view);
    const hook = renderHook(() => useRecordView<string>(opener));
    await waitFor(() => expect(hook.result.current.error).toBe(failure));
    await act(async () => hook.result.current.retry());
    expect(hook.result.current.records).toEqual(['recovered']);
  });

  it('publishes an opening error even when the rejection cannot be converted to a string', async () => {
    const failure: unknown = Object.create(null);
    const opener = async (): Promise<ControlledView<string>> => { throw failure; };
    const hook = renderHook(() => useRecordView(opener));
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.error).toBeInstanceOf(Error);
    expect(hook.result.current.error?.cause).toBe(failure);
    expect(hook.result.current.records).toEqual([]);
  });

  it('releases a disabled view and fences retained controls', async () => {
    const view = new ControlledView(['private']);
    const opener = async () => view;
    const hook = renderHook(({ enabled }) => useRecordView(enabled ? opener : null), { initialProps: { enabled: true } });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    const oldRetry = hook.result.current.retry;
    hook.rerender({ enabled: false });
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.records).toEqual([]);
    expect(view.close).toHaveBeenCalledOnce();
    await expect(oldRetry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
  });

  it('coalesces pagination and fences its completion after binding changes', async () => {
    let current = true;
    let notifyBinding = (): void => {};
    const page = deferred<void>();
    const view = new ControlledView(['first']);
    view.loadMore.mockImplementation(() => page.promise);
    const observer = new RecordViewObserver(async () => view, {
      isCurrent: () => current,
      subscribe: (notify) => { notifyBinding = notify; return () => {}; },
    });
    const stop = subscribeObserver(observer);
    await observer.retry();
    const first = observer.loadMore();
    expect(observer.loadMore()).toBe(first);
    expect(observer.getSnapshot().isLoadingMore).toBe(true);
    await Promise.resolve();
    current = false;
    notifyBinding();
    expect(observer.getSnapshot().status).toBe('idle');
    page.resolve();
    await first;
    expect(observer.getSnapshot().records).toEqual([]);
    await expect(observer.loadMore()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    stop();
  });
});
