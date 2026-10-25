import { act, renderHook, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createRecordStore } from '../src/config/index.js';
import { useRecords, useRecordView } from '../src/index.js';
import { EnboxBindingChangedError } from '../src/errors.js';
import { ControlledView, deferred } from './helpers.js';

describe('selected record owners', () => {
  it('keeps construction and SSR inert and shares one view with React and controllers', async () => {
    const native = new ControlledView(['saved']);
    const open = vi.fn(async (_key: string, _signal: AbortSignal) => native);
    const store = createRecordStore({ selection: 'a' as string | null, open });
    function Shell() { const state = useRecordView(store); return <p>{`${state.selection}:${state.status}`}</p>; }
    expect(renderToString(<Shell />)).toContain('a:idle');
    expect(open).not.toHaveBeenCalled();
    const stop = store.subscribe(() => {});
    const first = renderHook(() => useRecordView(store));
    const second = renderHook(() => useRecordView(store));
    await waitFor(() => expect(first.result.current.records).toEqual(['saved']));
    expect(first.result.current).toBe(store.getSnapshot());
    expect(second.result.current.selection).toBe('a');
    expect(open).toHaveBeenCalledOnce();
    first.unmount(); second.unmount(); stop();
    expect(native.close).not.toHaveBeenCalled();
    await store.close();
    expect(native.close).toHaveBeenCalledOnce();
  });

  it('resolves select on attachment while ready still awaits collection settlement', async () => {
    const native = new ControlledView<string>();
    native.publish({ status: 'loading', records: [], current: false, hasMore: false });
    const open = vi.fn(async (_key: string) => native);
    const store = createRecordStore({ selection: null as string | null, open });
    await store.select('a');
    expect(store.getSnapshot()).toMatchObject({ selection: 'a', status: 'loading' });
    let ready = false;
    const settled = store.ready().then((state) => { ready = true; return state; });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(store.select('a')).toBe(store.select('a'));
    native.publish({ status: 'ready', records: ['saved'], current: true, hasMore: false });
    expect(await settled).toBe(store.getSnapshot());
    expect(open).toHaveBeenCalledOnce();
    await store.close();
  });

  it('keeps an already-aborted readiness waiter from activating the selection', async () => {
    const native = new ControlledView(['saved']);
    const open = vi.fn(async () => native);
    const store = createRecordStore({ selection: 'a', open });
    const waiter = new AbortController();
    const reason = new Error('readiness cancelled');
    waiter.abort(reason);
    await expect(store.ready({ signal: waiter.signal })).rejects.toBe(reason);
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
    expect((await store.ready()).selection).toBe('a');
    expect(open).toHaveBeenCalledOnce();
    await store.close();
  });

  it.each(['loading', 'error'] as const)('returns the resolved ready state even if the native view immediately becomes %s', async (status) => {
    const native = new ControlledView<string>();
    native.publish({ status: 'loading', records: [], current: false, hasMore: false });
    const store = createRecordStore({ selection: 'a', open: async () => native });
    await store.select('a');
    const ready = store.ready();
    native.publish({ status: 'ready', records: ['saved'], current: true, hasMore: false });
    native.publish(status === 'error'
      ? { status, records: [], current: false, hasMore: false, error: new Error('later state') }
      : { status, records: [], current: false, hasMore: false });
    expect(await ready).toMatchObject({ status: 'ready', selection: 'a', records: ['saved'] });
    expect(store.getSnapshot().status).toBe(status);
    await store.close();
  });

  it('shares the checked attachment promise across concurrent retries', async () => {
    const pending = deferred<ControlledView<string>>();
    const store = createRecordStore({ selection: null as string | null, open: async () => pending.promise });
    const selecting = store.select('a');
    expect(store.retry()).toBe(selecting);
    expect(store.retry()).toBe(store.retry());
    pending.resolve(new ControlledView(['saved']));
    await selecting;
    await store.close();
  });

  it('does not redirect a retained React pagination control to a replacement selection', async () => {
    const views: ControlledView<string>[] = [];
    const store = createRecordStore({ selection: 'first', open: async (key: string) => {
      const view = new ControlledView([key]);
      views.push(view);
      return view;
    } });
    const hook = renderHook(() => useRecords(store));
    try {
      await waitFor(() => expect(hook.result.current.status).toBe('ready'));
      const captured = hook.result.current.loadMore;
      await act(async () => { await store.select('next'); });
      expect(hook.result.current.selection).toBe('next');
      await expect(captured()).rejects.toBeInstanceOf(EnboxBindingChangedError);
      expect(views[1]!.loadMore).not.toHaveBeenCalled();
      await act(async () => { await hook.result.current.loadMore(); });
      expect(views[1]!.loadMore).toHaveBeenCalledOnce();
      await act(async () => { await store.select('first'); });
      await expect(captured()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    } finally {
      hook.unmount();
      await store.close();
    }
  });

  it('publishes an atomic replacement and rejects ready waiters for the retired selection', async () => {
    const first = new ControlledView(['a']);
    const pending = deferred<ControlledView<string>>();
    const store = createRecordStore({ selection: null as string | null,
      open: async (key) => key === 'a' ? first : pending.promise });
    await store.select('a');
    const oldRetry = store.getSnapshot().retry;
    const snapshots: Array<{ selection: string | null; records: readonly string[] }> = [];
    store.subscribe(() => { snapshots.push(store.getSnapshot()); });
    const selecting = store.select('b');
    expect(store.getSnapshot()).toMatchObject({ selection: 'b', status: 'loading', records: [] });
    await expect(oldRetry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    const ready = store.ready();
    const rejected = expect(ready).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await store.select(null);
    await rejected;
    const cancelled = expect(selecting).rejects.toBeInstanceOf(EnboxBindingChangedError);
    const late = new ControlledView(['b']);
    pending.resolve(late);
    await cancelled;
    expect(first.close).toHaveBeenCalledOnce();
    expect(late.close).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({ selection: null, status: 'idle', records: [] });
    expect(snapshots.every(({ selection, records }) => selection !== 'b' || !records.includes('a'))).toBe(true);
    await store.close();
  });

  it('cleans late native views without redirecting retired opening failures', async () => {
    const pending = deferred<ControlledView<string>>();
    const failure = new Error('original opener failed');
    const store = createRecordStore({ selection: null as string | null, open: async () => pending.promise });
    const selecting = store.select('a');
    await Promise.resolve();
    await store.close();
    const rejected = expect(selecting).rejects.toBe(failure);
    pending.reject(failure);
    await rejected;
  });

  it('allows cleanup to replace a selection without opening or publishing the obsolete replacement', async () => {
    const first = new ControlledView(['a']);
    const third = new ControlledView(['c']);
    const open = vi.fn(async (key: string) => key === 'a' ? first : third);
    const store = createRecordStore({ selection: null as string | null, open });
    await store.select('a');
    let replacement!: Promise<void>;
    first.close.mockImplementationOnce(async () => { replacement = store.select('c'); });
    await expect(store.select('b')).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await replacement;
    expect(store.getSnapshot()).toMatchObject({ selection: 'c', records: ['c'] });
    expect(open.mock.calls.map(([key]) => key)).toEqual(['a', 'c']);
    await store.close();
  });

  it('keeps local row updates transient and prevents a reentrant updater from writing into a new selection', async () => {
    const native = new ControlledView(['saved']);
    const store = createRecordStore({ selection: null as string | null, open: async () => native });
    await store.select('a');
    const rows = ['saved', 'created'];
    store.updateRecords(() => rows);
    rows.push('caller mutation');
    expect(store.getSnapshot().records).toEqual(['saved', 'created']);
    native.publish({ status: 'ready', records: ['saved'], current: true, hasMore: false });
    expect(store.getSnapshot().records).toEqual(['saved']);
    expect(() => store.updateRecords(() => { void store.select(null); return ['stale']; }))
      .toThrow(EnboxBindingChangedError);
    expect(store.getSnapshot()).toMatchObject({ selection: null, records: [] });
    await store.close();
  });

  it('makes owner abort terminal, including an owner aborted before observation', async () => {
    const owner = new AbortController();
    const native = new ControlledView(['saved']);
    const open = vi.fn(async () => native);
    const store = createRecordStore({ selection: null as string | null, open, signal: owner.signal });
    await store.select('a');
    act(() => owner.abort());
    expect(store.getSnapshot()).toMatchObject({ selection: null, status: 'idle', records: [] });
    await expect(store.select('b')).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(() => store.updateRecords(() => ['stale'])).toThrow(EnboxBindingChangedError);
    expect(native.close).toHaveBeenCalledOnce();
    const inert = createRecordStore({ selection: 'a', open, signal: owner.signal });
    inert.subscribe(() => {});
    expect(inert.getSnapshot().selection).toBeNull();
    expect(open).toHaveBeenCalledOnce();
    await store.close(); await inert.close();
  });

  it('awaits acquired cleanup from replaced selections when the owner closes', async () => {
    const cleanup = deferred<void>();
    const first = new ControlledView(['a']);
    first.close.mockImplementation(() => cleanup.promise);
    const second = new ControlledView(['b']);
    const store = createRecordStore({ selection: null as string | null, open: async (key) => key === 'a' ? first : second });
    await store.select('a'); await store.select('b');
    let closed = false;
    const closing = store.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    cleanup.resolve(); await closing; expect(closed).toBe(true);
  });

  it('waits for old and current cleanup across concurrent closes and reports failures once', async () => {
    const oldCleanup = deferred<void>();
    const currentCleanup = deferred<void>();
    const oldView = new ControlledView(['a']);
    const currentView = new ControlledView(['b']);
    oldView.close.mockImplementation(() => oldCleanup.promise);
    currentView.close.mockImplementation(() => currentCleanup.promise);
    const failure = new Error('old selection cleanup failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createRecordStore({ selection: null as string | null,
      open: async (key) => key === 'a' ? oldView : currentView });
    try {
      await store.select('a');
      await store.select('b');
      let completed = 0;
      const first = store.close().then(() => { completed += 1; });
      const second = store.close().then(() => { completed += 1; });
      currentCleanup.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(completed).toBe(0);
      oldCleanup.reject(failure);
      await Promise.all([first, second]);
      expect(completed).toBe(2);
      expect(oldView.close).toHaveBeenCalledOnce();
      expect(currentView.close).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledExactlyOnceWith('[@enbox/react] Resource cleanup failed.', failure);
    } finally {
      oldCleanup.resolve();
      currentCleanup.resolve();
      await store.close();
      warn.mockRestore();
    }
  });

  it('includes a retiring native view when its cleanup synchronously closes the owner', async () => {
    const cleanup = deferred<void>();
    const native = new ControlledView(['a']);
    const store = createRecordStore({ selection: null as string | null, open: async () => native });
    await store.select('a');
    let closing!: Promise<void>;
    native.close.mockImplementationOnce(() => {
      closing = store.close();
      return cleanup.promise;
    });
    await expect(store.select('b')).rejects.toBeInstanceOf(EnboxBindingChangedError);
    let closed = false;
    void closing.then(() => { closed = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(closed).toBe(false);
    cleanup.resolve(); await closing;
    expect(native.close).toHaveBeenCalledOnce();
  });

  it('publishes opening errors and retries the same selected key', async () => {
    const failure = new Error('open failed');
    const native = new ControlledView(['recovered']);
    const open = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(native);
    const store = createRecordStore<string, string>({ selection: null, open });
    await expect(store.select('a')).rejects.toBe(failure);
    expect(store.getSnapshot()).toMatchObject({ selection: 'a', status: 'error', error: failure });
    store.updateRecords(() => ['created']);
    expect(store.getSnapshot()).toMatchObject({ selection: 'a', status: 'error', records: ['created'] });
    await store.retry();
    expect(store.getSnapshot()).toMatchObject({ selection: 'a', records: ['recovered'] });
    await store.close();
  });
});

describe('owner pagination policy', () => {
  it('publishes one failure for a non-expandable view that reports more records', async () => {
    const native = new ControlledView(['saved']);
    native.publish({ status: 'ready', records: ['saved'], current: true, hasMore: true });
    const store = createRecordStore(async () => ({
      getSnapshot: native.getSnapshot, subscribe: native.subscribe,
      ready: () => native.ready(), close: native.close,
    }), { loadAll: true });
    const loadMore = vi.spyOn(store, 'loadMore');
    store.subscribe(() => {});
    await waitFor(() => expect(store.getSnapshot()).toMatchObject({ status: 'error', records: ['saved'], error: expect.any(TypeError) }));
    expect(loadMore).toHaveBeenCalledOnce();
    await store.close();
  });

  it('expands fixed and selected stores through the same native view', async () => {
    for (const selected of [false, true]) {
      const native = new ControlledView(['first']);
      native.publish({ status: 'ready', records: ['first'], current: true, hasMore: true });
      native.loadMore.mockImplementation(async () => {
        native.publish({ status: 'ready', records: ['first', 'last'], current: true, hasMore: false });
      });
      const open = vi.fn(async () => native);
      const store = selected ? createRecordStore({ selection: 'a', open, loadAll: true })
        : createRecordStore(open, { loadAll: true });
      await store.ready();
      await waitFor(() => expect(store.getSnapshot().records).toEqual(['first', 'last']));
      expect(open).toHaveBeenCalledOnce(); expect(native.loadMore).toHaveBeenCalledOnce();
      await store.close();
    }
  });

  it('publishes an expansion failure with the retained rows and stops retrying it', async () => {
    const native = new ControlledView(['saved']);
    native.publish({ status: 'ready', records: ['saved'], current: true, hasMore: true });
    const failure = new Error('next page failed');
    native.loadMore.mockRejectedValue(failure);
    const store = createRecordStore(async () => native, { loadAll: true });
    store.subscribe(() => {});
    await waitFor(() => expect(store.getSnapshot()).toMatchObject({ status: 'error', records: ['saved'], error: failure }));
    expect(native.loadMore).toHaveBeenCalledOnce();
    await store.close();
  });

  it('keeps a replacement selection intact when its retired auto-expansion fails', async () => {
    const first = new ControlledView(['a']);
    first.publish({ status: 'ready', records: ['a'], current: true, hasMore: true });
    const expansion = deferred<void>();
    first.loadMore.mockImplementation(() => expansion.promise);
    const second = new ControlledView(['b']);
    const store = createRecordStore({ selection: null as string | null, loadAll: true,
      open: async (key) => key === 'a' ? first : second });
    await store.select('a');
    await waitFor(() => expect(first.loadMore).toHaveBeenCalledOnce());
    await store.select('b');
    const current = store.getSnapshot();
    expansion.reject(new Error('retired expansion failed'));
    await waitFor(() => expect(first.close).toHaveBeenCalledOnce());
    await Promise.resolve(); await Promise.resolve();
    expect(store.getSnapshot()).toBe(current);
    expect(current).toMatchObject({ selection: 'b', status: 'ready', records: ['b'] });
    await store.close();
  });
});
