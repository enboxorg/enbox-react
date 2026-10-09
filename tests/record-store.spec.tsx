import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRecords, useRecordView } from '../src/index.js';
import { createRecordStore } from '../src/config/index.js';
import { EnboxBindingChangedError } from '../src/errors.js';
import { ControlledView, deferred } from './helpers.js';

describe('shared record stores', () => {
  it('waits for acquired view cleanup when its owner closes it', async () => {
    const native = new ControlledView(['saved']);
    const cleanup = deferred<void>();
    native.close.mockImplementation(() => cleanup.promise);
    const store = createRecordStore(async () => native);
    await store.ready();
    let closed = false;
    const closing = store.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    cleanup.resolve();
    await closing;
    expect(closed).toBe(true);
  });
  it('shares one view with controllers and React consumers until its owner closes it', async () => {
    const native = new ControlledView(['first']);
    const open = vi.fn(async () => native);
    const store = createRecordStore(open);
    expect(open).not.toHaveBeenCalled();
    const controller = vi.fn();
    const release = store.subscribe(controller);
    const first = renderHook(() => useRecords(store));
    const second = renderHook(() => useRecordView(store));
    await waitFor(() => expect(first.result.current.records).toEqual(['first']));
    expect(second.result.current.records).toEqual(['first']);
    expect(open).toHaveBeenCalledOnce();
    act(() => native.publish({ status: 'ready', records: ['second'], hasMore: false, current: true }));
    expect(first.result.current.records).toEqual(['second']);
    expect(second.result.current.records).toEqual(['second']);
    expect(controller).toHaveBeenCalled();
    first.unmount();
    second.unmount();
    release();
    expect(native.close).not.toHaveBeenCalled();
    expect(store.getSnapshot().records).toEqual(['second']);
    await store.close();
    expect(native.close).toHaveBeenCalledOnce();
    expect(store.getSnapshot().status).toBe('idle');
    await expect(store.retry()).rejects.toBeInstanceOf(EnboxBindingChangedError);
  });

  it('keeps a headless catalog open after readiness so pagination can continue', async () => {
    const native = new ControlledView(['first']);
    const store = createRecordStore(async () => native);
    await expect(store.ready()).resolves.toMatchObject({ records: ['first'] });
    await store.loadMore();
    expect(native.loadMore).toHaveBeenCalledOnce();
    await store.close();
    await store.close();
    expect(native.close).toHaveBeenCalledOnce();
  });

  it('releases a late view and rejects readiness when closed during opening', async () => {
    const pending = deferred<ControlledView<string>>();
    const store = createRecordStore(() => pending.promise);
    const ready = store.ready();
    const rejection = expect(ready).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await Promise.resolve();
    await store.close();
    await rejection;
    const late = new ControlledView(['late']);
    pending.resolve(late);
    await waitFor(() => expect(late.close).toHaveBeenCalledOnce());
    expect(store.getSnapshot().status).toBe('idle');
  });

  it('releases shared views immediately when their owner signal aborts', async () => {
    const native = new ControlledView(['private']);
    const lifetime = new AbortController();
    const store = createRecordStore(async () => native, { signal: lifetime.signal });
    const hook = renderHook(() => useRecords(store));
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    act(() => lifetime.abort());
    expect(hook.result.current.records).toEqual([]);
    expect(native.close).toHaveBeenCalledOnce();
    await expect(store.ready()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    hook.unmount();
    await store.close();
  });

  it('cancels one readiness waiter without retiring the owner store', async () => {
    const native = new ControlledView<string>();
    native.publish({ status: 'loading', records: [], hasMore: false, current: false });
    const store = createRecordStore(async () => native);
    const waiter = new AbortController();
    const ready = store.ready({ signal: waiter.signal });
    const reason = new Error('cancelled waiter');
    const rejection = expect(ready).rejects.toBe(reason);
    waiter.abort(reason);
    await rejection;
    const remaining = store.ready();
    await waitFor(() => expect(native.listeners.size).toBe(1));
    native.publish({ status: 'ready', records: ['retained'], hasMore: false, current: true });
    await expect(remaining).resolves.toMatchObject({ records: ['retained'] });
    expect(native.close).not.toHaveBeenCalled();
    await store.close();
  });
});
