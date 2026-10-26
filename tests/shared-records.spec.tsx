import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createRecordStore } from '../src/config/index.js';
import { EnboxBindingChangedError, useEnboxMutation, useEnboxRecord, useEnboxRecords } from '../src/index.js';
import { connected, ControlledView, deferred, facade } from './helpers.js';
import { protocol, setup, type Note } from './record-fixture.js';

it('constructs an inert query and supports explicit parent-scoped headless creation', async () => {
  const { api, client, listeners } = setup();
  const store = createRecordStore({ client, protocol, path: 'space/note', options: null });
  try {
    expect(api.observe).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(store.commands.isCurrent()).toBe(false);
    const created = await store.commands.create({ text: 'Headless', done: false }, { within: 'first' });
    expect(created.data.text).toBe('Headless');
    expect(created.contextId).toBe('first/created');
    expect(api.observe).not.toHaveBeenCalled();
  } finally { await store.close(); }
});

it('shares one native view and projected array between controllers and React bindings', async () => {
  const { api, client, view, record } = setup();
  const store = createRecordStore({ client, protocol, path: 'space/note', options: { within: 'first' } });
  await store.ready();
  const first = renderHook(() => useEnboxRecords(store));
  const second = renderHook(() => useEnboxRecords(store));
  try {
    const value = { text: 'Shared', done: false };
    act(() => view.publish({ status: 'ready', current: true, hasMore: false,
      records: [{ record: record('one', value), value }] }));
    expect(api.observe).toHaveBeenCalledOnce();
    expect(first.result.current.records).toBe(store.getSnapshot().records);
    expect(second.result.current.records).toBe(first.result.current.records);
    first.unmount(); second.unmount();
    expect(view.close).not.toHaveBeenCalled();
    await store.commands.patch({ id: 'one', patch: { done: true } });
  } finally { first.unmount(); second.unmount(); await store.close(); }
  expect(view.close).toHaveBeenCalledOnce();
});

it('does not activate a different owner query just to bind another parent', async () => {
  const { client, api } = setup();
  const store = createRecordStore({ client, protocol, path: 'space/note', options: { within: 'first' } });
  const hook = renderHook(() => useEnboxRecords(store, { within: 'other' }));
  try {
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    expect(api.observe).toHaveBeenCalledOnce();
    expect(api.observe).toHaveBeenCalledWith('space/note', expect.objectContaining({ within: 'other' }));
    await act(async () => { await hook.result.current.create.mutateAsync({ text: 'Other', done: false }); });
    expect(api.create).toHaveBeenCalledWith('space/note', { data: { text: 'Other', done: false }, parentContextId: 'other' });
    await act(async () => { await store.close(); });
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.records).toEqual([]);
  } finally { hook.unmount(); await store.close(); }
});

it('never retargets a derived query when the supplied owner belongs to a retired identity', async () => {
  const { client, api, publish } = setup();
  const store = createRecordStore({ client, protocol, path: 'space/note', options: { within: 'first' } });
  const hook = renderHook(() => useEnboxRecords(store, { within: 'other' }));
  try {
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    const using = vi.fn(() => ({ records: api }));
    act(() => publish(connected(facade(using), 'did:example:replacement')));
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.records).toEqual([]);
    await expect(hook.result.current.create.mutateAsync({ text: 'Retired', done: false })).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(using).not.toHaveBeenCalled();
    expect(api.observe).toHaveBeenCalledOnce();
  } finally { hook.unmount(); await store.close(); }
});

it('borrows compatible parent queries and keeps differing parent queries independent', async () => {
  const { client, api } = setup();
  api.observe.mockImplementation(async () => new ControlledView<{ record: { id: string; contextId: string }; value: Note }>());
  const store = createRecordStore({ client, protocol, path: 'space/note', options: { within: 'first' } });
  const first = renderHook(() => useEnboxRecords(store, { within: 'first' }));
  const second = renderHook(() => useEnboxRecords(store, { within: 'other' }));
  try {
    await waitFor(() => expect(first.result.current.isReady && second.result.current.isReady).toBe(true));
    expect(api.observe).toHaveBeenCalledTimes(2);
    expect(first.result.current.records).toBe(store.getSnapshot().records);
    const captured = first.result.current.create;
    await act(async () => { await store.select({ within: 'other' }); });
    await waitFor(() => expect(second.result.current.records).toBe(store.getSnapshot().records));
    expect(captured.isCurrent()).toBe(false);
    await act(async () => {
      await first.result.current.create.mutateAsync({ text: 'First', done: false });
      await second.result.current.create.mutateAsync({ text: 'Other', done: false });
    });
    expect(api.create.mock.calls.map(([, request]) => (request as { parentContextId: string }).parentContextId)).toEqual(['first', 'other']);
  } finally { first.unmount(); second.unmount(); await store.close(); }
});

it('owns query inputs and retires captured commands only when their target changes', async () => {
  const { client, api } = setup();
  api.observe.mockImplementation(async () => new ControlledView<{ record: { id: string; contextId: string }; value: Note }>());
  const input = { within: 'first', filter: { recordId: 'one' } };
  const store = createRecordStore({ client, protocol, path: 'space/note', options: input });
  try {
    input.within = 'mutated'; input.filter.recordId = 'changed';
    expect(store.getSnapshot().selection?.within).toBe('first');
    expect(Object.isFrozen(store.getSnapshot().selection?.filter)).toBe(true);
    const commands = store.commands;
    await store.select({ within: 'first', filter: { recordId: 'two' } });
    expect(store.commands).toBe(commands);
    await store.select({ within: 'other' });
    await expect(commands.create({ text: 'Retired', done: false })).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await store.select({ within: 'first' });
    expect(commands.isCurrent()).toBe(false);
  } finally { await store.close(); }
});

it('captures destructive delete options before the parent read yields', async () => {
  const { client, api } = setup();
  const checking = deferred<{ id: string; contextId: string }>();
  api.read.mockImplementation(() => checking.promise);
  const store = createRecordStore({ client, protocol, path: 'space/note', options: { within: 'first', enabled: false } });
  try {
    const options = { prune: true };
    const issued = store.commands.delete('one', options);
    options.prune = false;
    checking.resolve({ id: 'one', contextId: 'first/one' });
    await issued;
    expect(api.delete).toHaveBeenCalledWith('space/note', { recordId: 'one', within: 'first', prune: true });
  } finally { await store.close(); }
});

it('fences a custom product mutation with the shared record scope', async () => {
  const { client, wrapper } = setup();
  const store = createRecordStore({ client, protocol, path: 'space/note', options: { within: 'first', enabled: false } });
  const pending = deferred<string>();
  const hook = renderHook(() => useEnboxMutation(async () => pending.promise, { scope: store.commands }), { wrapper });
  try {
    const captured = hook.result.current;
    let issued!: Promise<string>;
    act(() => { issued = captured.mutateAsync(); });
    expect(hook.result.current.isPending).toBe(true);
    await act(async () => { await store.select({ within: 'other', enabled: false }); });
    expect(hook.result.current.isPending).toBe(false);
    expect(captured.isCurrent()).toBe(false);
    await act(async () => { pending.resolve('Original outcome'); expect(await issued).toBe('Original outcome'); });
    await expect(captured.mutateAsync()).rejects.toBeInstanceOf(EnboxBindingChangedError);
  } finally { hook.unmount(); await store.close(); }
});

it('keeps captured single-record controls retired through a batched A-to-B-to-A selection', async () => {
  const { client, api } = setup();
  api.observe.mockImplementation(async () => new ControlledView<{ record: { id: string; contextId: string }; value: Note }>());
  const store = createRecordStore({ client, protocol, path: 'space/note',
    options: { within: 'first', filter: { recordId: 'a' }, pagination: { limit: 1 }, enabled: false } });
  const hook = renderHook(() => useEnboxRecord(store));
  try {
    const captured = hook.result.current.patch;
    const collectionCommands = store.commands;
    await act(async () => {
      await store.select({ within: 'first', filter: { recordId: 'b' }, pagination: { limit: 1 }, enabled: false });
      await store.select({ within: 'first', filter: { recordId: 'a' }, pagination: { limit: 1 }, enabled: false });
    });
    expect(store.commands).toBe(collectionCommands);
    expect(captured.isCurrent()).toBe(false);
    await expect(captured.mutateAsync({ done: true })).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { await hook.result.current.patch.mutateAsync({ done: true }); });
    expect(api.patch).toHaveBeenCalledOnce();
  } finally { hook.unmount(); await store.close(); }
});

it.each(['replace', 'abort', 'close'] as const)('masks private rows and retires operations on %s', async (reason) => {
  const { client, view, record, publish, lifetime } = setup();
  const store = createRecordStore({ client, protocol, path: 'space/note', options: { within: 'first' } });
  await store.ready();
  const value = { text: 'Private', done: false };
  view.publish({ status: 'ready', current: true, hasMore: false, records: [{ record: record('private', value), value }] });
  const commands = store.commands;
  if (reason === 'replace') publish(connected(facade(), 'did:example:other'));
  else if (reason === 'abort') lifetime.abort();
  else await store.close();
  expect(store.getSnapshot().records).toEqual([]);
  expect(commands.isCurrent()).toBe(false);
  await expect(commands.patch({ id: 'private', patch: { done: true } })).rejects.toBeInstanceOf(EnboxBindingChangedError);
  await store.close();
});
