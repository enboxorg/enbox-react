import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { defineProtocol, recordCodecs } from '../src/config/index.js';
import { EnboxBindingChangedError, EnboxProvider, useRecords } from '../src/index.js';
import { connected, ControlledView, controlledClient, facade } from './helpers.js';

const protocol = defineProtocol({
  protocol: 'https://example.test/notes', published: false,
  types: { note: { dataFormats: ['application/json'] } }, structure: { note: {} },
} as const, { note: recordCodecs.json<{ title: string }>() });

describe('typed record selection', () => {
  it('releases the old client binding even when both clients publish the same session and facade', async () => {
    const views: ControlledView<never>[] = [];
    const observe = vi.fn(async () => {
      const view = new ControlledView<never>();
      views.push(view);
      return view;
    });
    const initial = connected(facade(vi.fn(() => ({ records: { observe } }))));
    const first = controlledClient(initial);
    const second = controlledClient(initial);
    let selectedClient = first.client;
    const hook = renderHook(() => useRecords(protocol, 'note', { pagination: { limit: 1 } }), {
      wrapper: ({ children }) => <EnboxProvider client={selectedClient}>{children}</EnboxProvider>,
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    const oldLoad = hook.result.current.loadMore;
    selectedClient = second.client;
    hook.rerender();
    await waitFor(() => expect(observe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(views[0]?.close).toHaveBeenCalledOnce();
    expect(first.listeners.size).toBe(0);
    await expect(oldLoad()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(views[0]?.loadMore).not.toHaveBeenCalled();
    hook.unmount();
    expect(views[1]?.close).toHaveBeenCalledOnce();
    expect(second.listeners.size).toBe(0);
    expect(first.client.dispose).not.toHaveBeenCalled();
    expect(second.client.dispose).not.toHaveBeenCalled();
  });

  it('accepts inline options without reopening on equivalent values', async () => {
    const views: ControlledView<never>[] = [];
    const observe = vi.fn(async (_path, _request) => {
      const view = new ControlledView<never>();
      views.push(view);
      return view;
    });
    const initial = connected(facade(vi.fn(() => ({ records: { observe } }))));
    const { client } = controlledClient(initial);
    const hook = renderHook(({ limit }) => useRecords(protocol, 'note', {
      pagination: { limit }, materialize: true,
    }), {
      initialProps: { limit: 10 },
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    hook.rerender({ limit: 10 });
    expect(observe).toHaveBeenCalledOnce();
    const request = observe.mock.calls[0]?.[1];
    expect(request.materialize).toBe(true);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.enabled).toBeUndefined();
    hook.rerender({ limit: 20 });
    await waitFor(() => expect(observe).toHaveBeenCalledTimes(2));
    expect(views[0]?.close).toHaveBeenCalledOnce();
    expect(views[1]?.close).not.toHaveBeenCalled();
  });

  it('leaves materialization absent and becomes idle when disabled', async () => {
    const view = new ControlledView([]);
    const observe = vi.fn(async (_path, _request) => view);
    const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    const hook = renderHook(({ enabled }) => useRecords(protocol, 'note', { pagination: { limit: 1 }, enabled }), {
      initialProps: { enabled: true },
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(observe.mock.calls[0]?.[1].materialize).toBeUndefined();
    hook.rerender({ enabled: false });
    expect(hook.result.current.status).toBe('idle');
    expect(view.close).toHaveBeenCalledOnce();
  });

  it('fences view commands immediately when the session changes', async () => {
    const view = new ControlledView([]);
    const observe = vi.fn(async () => view);
    const { client, publish } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    const hook = renderHook(() => useRecords(protocol, 'note', { pagination: { limit: 1 } }), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    const oldLoad = hook.result.current.loadMore;
    let rejected!: Promise<void>;
    act(() => {
      publish({ phase: 'disconnected' });
      rejected = oldLoad();
    });
    await expect(rejected).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(hook.result.current.records).toEqual([]);
    expect(view.loadMore).not.toHaveBeenCalled();
  });
});
