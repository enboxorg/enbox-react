import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { defineProtocol, recordCodecs } from '../src/config/index.js';
import { EnboxBindingChangedError, EnboxProvider, useEnboxRecord, useEnboxRecords } from '../src/index.js';
import { connected, ControlledView, controlledClient, deferred, facade } from './helpers.js';

const protocol = defineProtocol({
  protocol: 'https://example.test/scoped-records', published: false,
  types: { space: { dataFormats: ['application/json'] }, note: { dataFormats: ['application/json'] }, choice: { dataFormats: ['application/json'] } },
  structure: { choice: { $recordLimit: { max: 1 } }, space: { note: { choice: { $recordLimit: { max: 1 } } }, choice: { $recordLimit: { max: 1 } } } },
} as const, {
  space: recordCodecs.json<{ name: string }>(), note: recordCodecs.json<{ text: string; done: boolean }>(),
  choice: recordCodecs.json<{ emoji: string }>(),
});

type Note = { text: string; done: boolean };
function setup<T = Note>() {
  const view = new ControlledView<{ record: { id: string; contextId: string }; value: T }>();
  const api = {
    observe: vi.fn(async (_path: string, _options: unknown) => view),
    query: vi.fn(async (_path: string, _options: unknown): Promise<{ records: { id: string; contextId: string }[] }> => ({ records: [] })),
    create: vi.fn(async (_path: string, _request: unknown) => ({ id: 'created', contextId: 'first/created' })),
    read: vi.fn(async (_path: string, id: string) => ({ id, contextId: `first/${id}` })),
    patch: vi.fn(async (_path: string, id: string, _patch: unknown) => ({ id })),
    delete: vi.fn(async (_path: string, _request: unknown) => {}),
  };
  const control = controlledClient(connected(facade(vi.fn(() => ({ records: api })))));
  const wrapper = ({ children }: { children: React.ReactNode }) => <EnboxProvider client={control.client}>{children}</EnboxProvider>;
  return { ...control, view, api, wrapper };
}

describe('local record commands', () => {
  it('projects native rows and scopes CRUD without copying query filters into writes', async () => {
    const { api, view, wrapper } = setup();
    const hook = renderHook(() => useEnboxRecords(protocol, 'space/note', {
      within: 'first', filter: { recordId: 'selected' }, pagination: { limit: 5 },
    }), { wrapper });
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    expect(api.observe).toHaveBeenCalledWith('space/note', expect.objectContaining({ within: 'first', materialize: true, pagination: { limit: 5 } }));
    await act(async () => { await hook.result.current.create.mutateAsync({ text: 'New', done: false }); });
    expect(api.create).toHaveBeenCalledWith('space/note', { data: { text: 'New', done: false }, parentContextId: 'first' });
    expect(hook.result.current.records).toEqual([]);
    act(() => view.publish({ status: 'ready', current: true, hasMore: false, records: [
      { record: { id: 'selected', contextId: 'first/selected' }, value: { text: 'Native', done: false } },
    ] }));
    expect(hook.result.current.records[0]).toMatchObject({ id: 'selected', contextId: 'first/selected', data: { text: 'Native' } });
    await act(async () => { await hook.result.current.patch.mutateAsync({ id: 'selected', patch: { done: true } }); });
    expect(api.patch).toHaveBeenCalledWith('space/note', 'selected', { done: true });
    await act(async () => { await hook.result.current.delete.mutateAsync('selected'); });
    expect(api.delete).toHaveBeenCalledWith('space/note', { recordId: 'selected', within: 'first' });
  });

  it('blocks IDs from another parent before either write', async () => {
    const { api, wrapper } = setup();
    api.read.mockResolvedValue({ id: 'foreign', contextId: 'other/foreign' });
    const hook = renderHook(() => useEnboxRecords(protocol, 'space/note', { within: 'first' }), { wrapper });
    await act(async () => {
      await expect(hook.result.current.patch.mutateAsync({ id: 'foreign', patch: { done: true } })).rejects.toThrow('selected parent');
      await expect(hook.result.current.delete.mutateAsync('foreign')).rejects.toThrow('selected parent');
    });
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('writes the checked ID even if caller variables change while the parent read is pending', async () => {
    const { api, wrapper } = setup();
    const reading = deferred<{ id: string; contextId: string }>();
    api.read.mockImplementation(() => reading.promise);
    const hook = renderHook(() => useEnboxRecords(protocol, 'space/note', { within: 'first' }), { wrapper });
    const variables = { id: 'checked', patch: { done: true } };
    let issued!: Promise<unknown>;
    act(() => { issued = hook.result.current.patch.mutateAsync(variables); });
    expect(api.read).toHaveBeenCalledWith('space/note', 'checked');
    variables.id = 'foreign';
    await act(async () => {
      reading.resolve({ id: 'checked', contextId: 'first/checked' });
      await issued;
    });
    expect(api.patch).toHaveBeenCalledWith('space/note', 'checked', { done: true });
  });

  it('tracks row progress and retires commands when the parent changes', async () => {
    const { api, wrapper } = setup();
    const pending = deferred<{ id: string }>();
    api.patch.mockImplementation(() => pending.promise);
    const hook = renderHook(({ within }) => useEnboxRecords(protocol, 'space/note', { within }), {
      wrapper, initialProps: { within: 'first' },
    });
    const captured = hook.result.current.patch;
    let issued!: Promise<unknown>;
    await act(async () => { issued = captured.mutateAsync({ id: 'a', patch: { done: true } }); });
    expect(hook.result.current.patch.isPendingFor('a')).toBe(true);
    expect(hook.result.current.patch.isPendingFor('b')).toBe(false);
    hook.rerender({ within: 'second' });
    expect(hook.result.current.patch.isPending).toBe(false);
    await expect(captured.mutateAsync({ id: 'b', patch: { done: true } })).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { pending.resolve({ id: 'a' }); await issued; });
    expect(captured.isCurrent()).toBe(false);
  });

  it('makes null inert and rejects old commands after session replacement', async () => {
    const { api, wrapper, publish } = setup();
    const inactive = renderHook(() => useEnboxRecords(protocol, 'space/note', null), { wrapper });
    expect(inactive.result.current.status).toBe('idle');
    await act(async () => {
      await expect(inactive.result.current.create.mutateAsync({ text: 'No', done: false })).rejects.toBeInstanceOf(EnboxBindingChangedError);
    });
    expect(api.observe).not.toHaveBeenCalled();
    const live = renderHook(() => useEnboxRecords(protocol, 'space'), { wrapper });
    const captured = live.result.current.create;
    act(() => publish(connected(facade(), 'did:example:bob')));
    await expect(captured.mutateAsync({ name: 'Old' })).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(api.create).not.toHaveBeenCalled();
  });

  it.each(['patch', 'delete'] as const)('keeps explicit-ID %s fenced to its requested parent', async (operation) => {
    const { api, wrapper } = setup();
    api.read.mockResolvedValue({ id: 'foreign', contextId: 'other/foreign' });
    const hook = renderHook(() => useEnboxRecord(protocol, 'space/note', {
      within: 'first', recordId: 'foreign', enabled: false,
    }), { wrapper });
    await act(async () => {
      if (operation === 'patch') {
        await expect(hook.result.current.patch.mutateAsync({ done: true })).rejects.toThrow('selected parent');
      } else {
        await expect(hook.result.current.delete.mutateAsync()).rejects.toThrow('selected parent');
      }
    });
    expect(api.query).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('keeps explicit-ID deletion state after an early view update (%s)', async (outcome) => {
    const { api, view, wrapper } = setup();
    const record = { id: 'note', contextId: 'first/note' };
    view.publish({ status: 'ready', current: true, hasMore: false, records: [
      { record, value: { text: 'Saved', done: false } },
    ] });
    const acknowledgment = deferred<void>();
    const failure = new Error('Delete acknowledgment failed');
    api.delete.mockImplementation(async () => {
      view.publish({ status: 'ready', current: true, hasMore: false, records: [] });
      await acknowledgment.promise;
    });
    const hook = renderHook(() => useEnboxRecord(protocol, 'space/note', { within: 'first', recordId: 'note' }), { wrapper });
    await waitFor(() => expect(hook.result.current.record?.id).toBe('note'));
    const deletion = hook.result.current.delete;
    const completed = vi.fn();
    let issued!: Promise<void>;
    try {
      await act(async () => { issued = deletion.mutateAsync(); });
      expect(hook.result.current.delete.isPending).toBe(true);
      expect(hook.result.current.data).toBeUndefined();
    } finally {
      await act(async () => {
        if (outcome === 'success') {
          acknowledgment.resolve(); await issued;
          if (deletion.isCurrent()) completed();
        } else {
          acknowledgment.reject(failure); await expect(issued).rejects.toBe(failure);
        }
      });
    }
    expect(completed).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
    expect(hook.result.current.delete.error).toBe(outcome === 'success' ? undefined : failure);
  });

  it('allows root writes with paused reads and keeps commands across read-only query changes', async () => {
    const { api, wrapper } = setup();
    const root = renderHook(() => useEnboxRecords(protocol, 'space', { enabled: false }), { wrapper });
    expect(root.result.current.status).toBe('idle');
    await act(async () => { await root.result.current.create.mutateAsync({ name: 'Root' }); });
    expect(api.create).toHaveBeenCalledWith('space', { data: { name: 'Root' } });
    const nested = renderHook(({ id }) => useEnboxRecords(protocol, 'space/note', {
      within: 'first', filter: { recordId: id },
    }), { wrapper, initialProps: { id: 'a' } });
    const captured = nested.result.current.create;
    nested.rerender({ id: 'b' });
    expect(captured.isCurrent()).toBe(true);
    await act(async () => { await captured.mutateAsync({ text: 'New', done: false }); });
    expect(api.create).toHaveBeenLastCalledWith('space/note', { data: { text: 'New', done: false }, parentContextId: 'first' });
  });

  it('rejects an ancestor scope for a deeper explicit-ID selection', () => {
    const { api, wrapper } = setup();
    expect(() => renderHook(() => useEnboxRecord(protocol, 'space/note/choice', {
      within: 'first', recordId: 'selected',
    }), { wrapper })).toThrow('direct parent context');
    expect(api.observe).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 7, null])('rejects an ambiguous or malformed JavaScript recordId (%s) before observing', (recordId) => {
    const { api, wrapper } = setup();
    expect(() => renderHook(() => useEnboxRecord(protocol, 'space/note', {
      within: 'first', recordId,
    } as never), { wrapper })).toThrow(TypeError);
    expect(api.observe).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('requires an ID even on a native singleton path', () => {
    const { api, wrapper } = setup();
    expect(() => renderHook(() => useEnboxRecord(protocol, 'space/choice', {
      within: 'first', recordId: undefined,
    } as never), { wrapper })).toThrow('nonempty recordId');
    expect(api.observe).not.toHaveBeenCalled();
  });

  it('keeps a null explicit-ID selection inert', () => {
    const { api, wrapper } = setup();
    const hook = renderHook(() => useEnboxRecord(protocol, 'space/note', null), { wrapper });
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current).not.toHaveProperty('set');
    expect(api.observe).not.toHaveBeenCalled();
  });

  it('selects a specific record, preserves rejected outcomes, and rejects remote scopes', async () => {
    const { api, wrapper } = setup();
    const hook = renderHook(() => useEnboxRecord(protocol, 'space/note', { within: 'first', recordId: 'a' }), { wrapper });
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    expect(api.observe).toHaveBeenCalledWith('space/note', expect.objectContaining({ filter: { recordId: 'a' } }));
    expect(hook.result.current).not.toHaveProperty('set');
    const error = new Error('Native patch failed');
    api.patch.mockRejectedValue(error);
    await act(async () => { await expect(hook.result.current.patch.mutateAsync({ done: true })).rejects.toBe(error); });
    expect(hook.result.current.patch.error).toBe(error);
    expect(() => renderHook(() => useEnboxRecords(protocol, 'space', { from: 'did:example:remote' } as never), { wrapper })).toThrow('local session');
  });
});
