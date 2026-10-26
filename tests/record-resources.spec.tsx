import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createRecordStore, defineRecordStore } from '../src/config/index.js';
import { EnboxBindingChangedError, EnboxProvider, EnboxRecordsProvider, useEnboxRecord, useEnboxRecords } from '../src/index.js';
import { connected, ControlledView, facade } from './helpers.js';
import { protocol, setup, type Note } from './record-fixture.js';

const spaces = defineRecordStore({ protocol, path: 'space' });
const notes = defineRecordStore({ protocol, path: 'space/note', options: null });
const oneNote = defineRecordStore({ protocol, path: 'space/note', kind: 'record', options: null });
const choice = defineRecordStore({ protocol, path: 'choice', kind: 'singleton' });

describe('shared record resources', () => {
  it('constructs inert owners and supports headless commands without opening a view', async () => {
    const { api, client, listeners } = setup();
    const store = createRecordStore(spaces, { client });
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
    const store = createRecordStore(spaces, { client });
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

  it('registers one owner per definition and releases provider-owned views on unmount', async () => {
    const { api, view, wrapper } = setup<{ name: string }>();
    const sources = { spaces };
    const hook = renderHook(() => ({ first: useEnboxRecords(spaces), second: useEnboxRecords(spaces) }), {
      wrapper: ({ children }) => wrapper({ children: <EnboxRecordsProvider records={sources}>{children}</EnboxRecordsProvider> }),
    });
    await waitFor(() => expect(hook.result.current.first.isReady).toBe(true));
    expect(hook.result.current.first.store).toBe(hook.result.current.second.store);
    expect(api.observe).toHaveBeenCalledOnce();
    hook.unmount();
    expect(view.close).toHaveBeenCalledOnce();
  });

  it('borrows supplied controller owners through the main provider without closing them', async () => {
    const { api, view, client } = setup<{ name: string }>();
    const store = createRecordStore(spaces, { client });
    await store.ready();
    const records = { spaces: store };
    const hook = renderHook(() => useEnboxRecords(spaces), {
      wrapper: ({ children }) => <EnboxProvider client={client} records={records}>{children}</EnboxProvider>,
    });
    expect(hook.result.current.store).toBe(store);
    expect(api.observe).toHaveBeenCalledOnce();
    hook.unmount();
    expect(view.close).not.toHaveBeenCalled();
    await store.commands.create({ name: 'Controller still owns it' });
    await store.close();
    expect(view.close).toHaveBeenCalledOnce();
  });

  it('keeps registered definitions lazy until a consumer observes them', () => {
    const { client, api } = setup();
    const records = { spaces };
    const hook = renderHook(() => null, {
      wrapper: ({ children }) => <EnboxProvider client={client} records={records}>{children}</EnboxProvider>,
    });
    expect(api.observe).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('inherits unrelated definitions while a nested scope supplies its own owner', async () => {
    const { client, api } = setup();
    api.observe.mockImplementation(async () => new ControlledView<{ record: { id: string; contextId: string }; value: Note }>());
    const local = createRecordStore(notes, { client, selection: { within: 'first' } });
    const root = { spaces, notes };
    const records = { notes: local };
    const hook = renderHook(() => ({ spaces: useEnboxRecords(spaces), notes: useEnboxRecords(notes) }), {
      wrapper: ({ children }) => <EnboxProvider client={client} records={root}>
        <EnboxRecordsProvider records={records}>{children}</EnboxRecordsProvider>
      </EnboxProvider>,
    });
    try {
      await waitFor(() => expect(hook.result.current.notes.isReady).toBe(true));
      expect(hook.result.current.spaces.store.definition).toBe(spaces);
      expect(hook.result.current.notes.store).toBe(local);
      expect(api.observe).toHaveBeenCalledTimes(2);
    } finally { hook.unmount(); await local.close(); }
  });

  it('rejects accidentally mixing a registered owner with another provider client', async () => {
    const first = setup();
    const second = setup();
    const owner = createRecordStore(spaces, { client: first.client });
    const records = { owner };
    try {
      expect(() => renderHook(() => useEnboxRecords(spaces), {
        wrapper: ({ children }) => <EnboxProvider client={second.client} records={records}>{children}</EnboxProvider>,
      })).toThrow('surrounding EnboxProvider client');
      expect(first.api.observe).not.toHaveBeenCalled();
    } finally { await owner.close(); }
  });

  it('does not inherit a definition through a nested connection-client boundary', async () => {
    const first = setup();
    const second = setup();
    const owner = createRecordStore(spaces, { client: first.client });
    const records = { owner };
    try {
      expect(() => renderHook(() => useEnboxRecords(spaces), {
        wrapper: ({ children }) => <EnboxRecordsProvider records={records}>
          <EnboxProvider client={second.client}>{children}</EnboxProvider>
        </EnboxRecordsProvider>,
      })).toThrow('client boundaries');
      expect(first.api.observe).not.toHaveBeenCalled();
    } finally { await owner.close(); }
  });

  it('retains command scope across filter changes and retires it when the parent changes', async () => {
    const { client, api } = setup();
    api.observe.mockImplementation(async () => new ControlledView<{ record: { id: string; contextId: string }; value: Note }>());
    const store = createRecordStore(notes, { client });
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
    const record = createRecordStore(oneNote, { client });
    const singleton = createRecordStore(choice, { client });
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
    const store = createRecordStore(notes, { client });
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
    const store = createRecordStore(notes, { client, selection: request });
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
    const store = createRecordStore(spaces, { client });
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
