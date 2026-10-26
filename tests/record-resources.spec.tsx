import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createRecordStore, createRecordsStore } from '../src/config/index.js';
import { EnboxBindingChangedError, useEnboxRecord, useEnboxRecords } from '../src/index.js';
import { connected, ControlledView, facade } from './helpers.js';
import { protocol, setup, type Note } from './record-fixture.js';

describe('shared record resources', () => {
  it('keeps parameterized detail views independent when one selected ID changes', async () => {
    const { api, wrapper } = setup();
    api.observe.mockImplementation(async (_path, options) => {
      const { within, filter: { recordId } } = options as { within: string; filter: { recordId: string } };
      return new ControlledView<{ record: { id: string; contextId: string }; value: Note }>([
        { record: { id: recordId, contextId: `${within}/${recordId}` }, value: { text: recordId, done: false } },
      ]);
    });
    const first = renderHook(({ id }) => useEnboxRecord(protocol, 'space/note', { within: 'first', recordId: id }), {
      wrapper, initialProps: { id: 'a' },
    });
    const second = renderHook(() => useEnboxRecord(protocol, 'space/note', { within: 'first', recordId: 'b' }), { wrapper });
    try {
      await waitFor(() => expect(first.result.current.data?.text).toBe('a'));
      await waitFor(() => expect(second.result.current.data?.text).toBe('b'));
      const previous = first.result.current.patch;
      const unchanged = second.result.current.patch;
      first.rerender({ id: 'c' });
      await waitFor(() => expect(first.result.current.data?.text).toBe('c'));
      expect(second.result.current.data?.text).toBe('b');
      expect(previous.isCurrent()).toBe(false);
      expect(unchanged.isCurrent()).toBe(true);
      await act(async () => { await second.result.current.patch.mutateAsync({ done: true }); });
      expect(api.patch).toHaveBeenCalledWith('space/note', 'b', { done: true });
      expect(api.observe).toHaveBeenCalledTimes(3);
    } finally { first.unmount(); second.unmount(); }
  });

  it('constructs inert owners and supports headless commands without opening a view', async () => {
    const { api, client, listeners } = setup();
    const store = createRecordsStore({ client, protocol, path: 'space' });
    expect(api.observe).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    await store.commands.create({ name: 'Work' });
    expect(api.create).toHaveBeenCalledWith('space', { data: { name: 'Work' } });
    expect(api.observe).not.toHaveBeenCalled();
    const captured = store.commands;
    await store.close();
    expect(captured.isCurrent()).toBe(false);
    await expect(captured.create({ name: 'Closed' })).rejects.toBeInstanceOf(EnboxBindingChangedError);
  });

  it('shares one native view between a headless owner and two provider-free React bindings', async () => {
    const { api, view, client } = setup<{ name: string }>();
    const store = createRecordsStore({ client, protocol, path: 'space' });
    const first = renderHook(() => useEnboxRecords(store));
    const second = renderHook(() => useEnboxRecords(store));
    try {
      await act(async () => { await store.ready(); });
      const created = await store.commands.create({ name: 'Shared' });
      act(() => view.publish({ status: 'ready', current: true, hasMore: false, records: [
        { record: created, value: { name: 'Shared' } },
      ] }));
      expect(first.result.current.store).toBe(store);
      expect(first.result.current.records).toBe(store.getSnapshot().records);
      expect(second.result.current.records).toBe(first.result.current.records);
      expect(first.result.current.records[0]?.data.name).toBe('Shared');
      expect(api.observe).toHaveBeenCalledOnce();
      first.unmount();
      expect(view.close).not.toHaveBeenCalled();
      await act(async () => { await second.result.current.create.mutateAsync({ name: 'React' }); });
      expect(api.create).toHaveBeenLastCalledWith('space', { data: { name: 'React' } });
    } finally {
      first.unmount(); second.unmount(); await store.close();
    }
    expect(view.close).toHaveBeenCalledOnce();
  });

  it('retains command scope across filter changes and retires it when the parent changes', async () => {
    const { client, api } = setup();
    api.observe.mockImplementation(async () => new ControlledView<{ record: { id: string; contextId: string }; value: Note }>());
    const store = createRecordsStore({ client, protocol, path: 'space/note', options: null });
    const hook = renderHook(() => useEnboxRecords(store));
    try {
      expect(hook.result.current.status).toBe('idle');
      await act(async () => { await store.select({ within: 'first' }); });
      const commands = store.commands;
      const captured = hook.result.current.create;
      await act(async () => { await store.select({ within: 'first', filter: { recordId: 'a' } }); });
      expect(store.commands).toBe(commands);
      expect(captured.isCurrent()).toBe(true);
      await act(async () => { await store.select({ within: 'second' }); });
      expect(commands.isCurrent()).toBe(false);
      expect(captured.isCurrent()).toBe(false);
      await expect(commands.create({ text: 'Old', done: false })).rejects.toBeInstanceOf(EnboxBindingChangedError);
      await act(async () => { await store.select({ within: 'first', enabled: false }); });
      expect(commands.isCurrent()).toBe(false);
      expect(hook.result.current.status).toBe('idle');
      await store.commands.create({ text: 'Paused read', done: false });
      expect(api.create).toHaveBeenLastCalledWith('space/note', { data: { text: 'Paused read', done: false }, parentContextId: 'first' });
    } finally { hook.unmount(); await store.close(); }
  });

  it('binds record and singleton stores through the same native command implementation', async () => {
    const { client, api } = setup();
    const record = createRecordStore({ client, protocol, path: 'space/note', options: null });
    const singleton = createRecordStore({ client, protocol, path: 'choice' });
    const one = renderHook(() => useEnboxRecord(record));
    const slot = renderHook(() => useEnboxRecord(singleton));
    try {
      await act(async () => { await record.select({ within: 'first', recordId: 'selected', enabled: false }); });
      await act(async () => {
        await one.result.current.patch.mutateAsync({ done: true });
        await slot.result.current.set.mutateAsync({ emoji: '🌱' });
      });
      expect(api.patch).toHaveBeenCalledWith('space/note', 'selected', { done: true });
      expect(api.set).toHaveBeenCalledWith('choice', { data: { emoji: '🌱' } });
      expect(one.result.current).not.toHaveProperty('set');
    } finally { one.unmount(); slot.unmount(); await Promise.all([record.close(), singleton.close()]); }
  });

  it('rejects readiness if selection changes between native settlement and projection', async () => {
    const { client, api } = setup();
    api.observe.mockImplementation(async () => new ControlledView<{ record: { id: string; contextId: string }; value: Note }>());
    const store = createRecordsStore({ client, protocol, path: 'space/note', options: null });
    try {
      await store.select({ within: 'first' });
      const pending = store.ready();
      queueMicrotask(() => { void store.select({ within: 'second' }); });
      await expect(pending).rejects.toBeInstanceOf(EnboxBindingChangedError);
    } finally { await store.close(); }
  });

  it('owns immutable selections and leaves display-only updates to the next native publication', async () => {
    const { client, view, api } = setup();
    const request = { within: 'first', filter: { recordId: 'selected' } };
    const store = createRecordsStore({ client, protocol, path: 'space/note', options: request });
    try {
      request.within = 'other';
      request.filter.recordId = 'changed';
      await store.ready();
      expect(store.getSnapshot().selection).toEqual({ within: 'first', filter: { recordId: 'selected' } });
      expect(Object.isFrozen(store.getSnapshot().selection?.filter)).toBe(true);
      const record = await store.commands.create({ text: 'Created', done: false });
      const row = { id: record.id, contextId: record.contextId, record, data: { text: 'Created', done: false } };
      store.updateRecords((rows) => [...rows, row]);
      expect(store.getSnapshot().records).toEqual([row]);
      view.publish({ status: 'ready', current: true, hasMore: false, records: [] });
      expect(store.getSnapshot().records).toEqual([]);
      await store.commands.delete('selected', { prune: true });
      expect(api.delete).toHaveBeenCalledWith('space/note', { recordId: 'selected', within: 'first', prune: true });
    } finally { await store.close(); }
  });

  it.each(['replace', 'abort', 'close'] as const)('masks rows and retires commands immediately on %s', async (retirement) => {
    const { client, publish, api, view, lifetime } = setup<{ name: string }>();
    const store = createRecordsStore({ client, protocol, path: 'space' });
    await store.ready();
    view.publish({ status: 'ready', current: true, hasMore: false, records: [
      { record: { id: 'space', contextId: 'space' }, value: { name: 'Private' } },
    ] });
    const commands = store.commands;
    if (retirement === 'replace') publish(connected(facade(), 'did:example:bob'));
    else if (retirement === 'abort') lifetime.abort();
    else await store.close();
    expect(store.getSnapshot().status).toBe('idle');
    expect(store.getSnapshot().records).toEqual([]);
    expect(commands.isCurrent()).toBe(false);
    await expect(commands.create({ name: 'No' })).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(api.create).not.toHaveBeenCalled();
    await store.close();
  });
});
