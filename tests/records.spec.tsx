import { act, renderHook, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { defineProtocol, recordCodecs } from '../src/config/index.js';
import { EnboxBindingChangedError, EnboxProvider, useRecords } from '../src/index.js';
import { connected, ControlledView, controlledClient, facade } from './helpers.js';

const protocol = defineProtocol({
  protocol: 'https://example.test/notes', published: false,
  types: { note: { dataFormats: ['application/json'] } }, structure: { note: {} },
} as const, { note: recordCodecs.json<{ title: string }>() });

const childProtocol = defineProtocol({
  protocol: 'https://example.test/notes-with-children', published: false,
  types: {
    note: { dataFormats: ['application/json'] },
    preview: { dataFormats: ['application/json'] },
    stats: { dataFormats: ['application/json'] },
  },
  structure: {
    note: { preview: { $recordLimit: { max: 1 } }, stats: { $recordLimit: { max: 1 } } },
  },
} as const, {
  note: recordCodecs.json<{ title: string }>(),
  preview: recordCodecs.json<{ body: string }>(),
  stats: recordCodecs.json<{ words: number }>(),
});

describe('typed record selection', () => {
  it.each(['enabled', 'from', 'within', 'protocolRole', 'filter', 'dateSort', 'pagination', 'materialize'] as const)(
    'rejects a top-level %s accessor without evaluating it or opening a view', (key) => {
      const getter = vi.fn(() => { throw new Error('Option accessor was evaluated.'); });
      const options = { pagination: { limit: 1 } };
      Object.defineProperty(options, key, { enumerable: true, get: getter });
      const observe = vi.fn(async () => new ControlledView<never>());
      const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
      expect(() => renderHook(() => useRecords(childProtocol, 'note', options as never), {
        wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
      })).toThrow('Record queries cannot contain getters.');
      expect(getter).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
    },
  );

  it('rejects a changing materialization accessor during server rendering before its guard can be bypassed', () => {
    const materialize = vi.fn()
      .mockReturnValueOnce({ children: ['note/preview'] })
      .mockReturnValue({ children: ['note/preview'], extra: undefined });
    const options = { pagination: { limit: 1 }, get materialize() { return materialize(); } };
    const { client } = controlledClient();
    function Notes() { return <output>{useRecords(childProtocol, 'note', options as never).status}</output>; }
    expect(() => renderToString(<EnboxProvider client={client}><Notes /></EnboxProvider>))
      .toThrow('Record queries cannot contain getters.');
    expect(materialize).not.toHaveBeenCalled();
    expect(client.initialize).not.toHaveBeenCalled();
  });

  it('rejects accessors in disabled selections while keeping ordinary disabled selections inert', () => {
    const filter = vi.fn(() => ({}));
    const options = { enabled: false, pagination: { limit: 1 }, get filter() { return filter(); } };
    const observe = vi.fn(async () => new ControlledView<never>());
    const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    const wrapper = ({ children }: { children: React.ReactNode }) => <EnboxProvider client={client}>{children}</EnboxProvider>;
    expect(() => renderHook(() => useRecords(protocol, 'note', options), { wrapper })).toThrow('getters');
    expect(filter).not.toHaveBeenCalled();
    const disabled = renderHook(() => useRecords(protocol, 'note', { enabled: false, pagination: { limit: 1 } }), { wrapper });
    expect(disabled.result.current.status).toBe('idle');
    expect(observe).not.toHaveBeenCalled();
  });

  it('accepts own data properties from null-prototype options and leaves unrelated accessors untouched', async () => {
    const unused = vi.fn(() => { throw new Error('Unselected option was evaluated.'); });
    const options = Object.assign(Object.create(null), { pagination: { limit: 1 }, materialize: true });
    Object.defineProperty(options, 'unused', { enumerable: true, get: unused });
    const observe = vi.fn(async (_path, _request) => new ControlledView<never>());
    const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    const hook = renderHook(() => useRecords(protocol, 'note', options), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(unused).not.toHaveBeenCalled();
    expect(observe.mock.calls[0]?.[1].materialize).toBe(true);
    expect(observe.mock.calls[0]?.[1]).not.toHaveProperty('unused');
    hook.unmount();
  });

  it.each([Object.create({ pagination: { limit: 1 } }), [{ pagination: { limit: 1 } }], {
    pagination: { limit: 1 }, [Symbol('query')]: true,
  }])('rejects top-level non-plain or symbol-bearing options without opening a view', (options) => {
    const observe = vi.fn(async () => new ControlledView<never>());
    const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    expect(() => renderHook(() => useRecords(protocol, 'note', options as never), {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    })).toThrow(TypeError);
    expect(observe).not.toHaveBeenCalled();
  });

  it('forwards child selections and keeps equivalent requests on the same view', async () => {
    const views: ControlledView<never>[] = [];
    const observe = vi.fn(async (_path, _request) => {
      const view = new ControlledView<never>();
      views.push(view);
      return view;
    });
    const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    const hook = renderHook(({ child }: { child: 'note/preview' | 'note/stats' }) =>
      useRecords(childProtocol, 'note', {
        pagination: { limit: 10 }, materialize: { children: [child] },
      }), {
      initialProps: { child: 'note/preview' },
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(observe.mock.calls[0]?.[1].materialize).toEqual({ children: ['note/preview'] });
    hook.rerender({ child: 'note/preview' });
    expect(observe).toHaveBeenCalledOnce();
    hook.rerender({ child: 'note/stats' });
    await waitFor(() => expect(observe).toHaveBeenCalledTimes(2));
    expect(observe.mock.calls[1]?.[1].materialize).toEqual({ children: ['note/stats'] });
    expect(views[0]?.close).toHaveBeenCalledOnce();
    hook.unmount();
    expect(views[1]?.close).toHaveBeenCalledOnce();
  });

  it('copies child selections before opening so caller mutations cannot change the request', async () => {
    const observe = vi.fn(async (_path, _request) => new ControlledView<never>());
    const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    const children: ('note/preview' | 'note/stats')[] = ['note/preview'];
    const hook = renderHook(() => useRecords(childProtocol, 'note', {
      pagination: { limit: 1 }, materialize: { children },
    }), { wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider> });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    children.push('note/stats');
    expect(observe.mock.calls[0]?.[1].materialize).toEqual({ children: ['note/preview'] });
    hook.unmount();
  });

  it('rejects unknown materialization keys even when their undefined values would be omitted', () => {
    const observe = vi.fn(async () => new ControlledView<never>());
    const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
    expect(() => renderHook(() => useRecords(childProtocol, 'note', {
      pagination: { limit: 1 },
      materialize: { children: ['note/preview'], extra: undefined } as never,
    }), { wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider> }))
      .toThrow('Record materialization supports only the children selection.');
    expect(observe).not.toHaveBeenCalled();
  });

  it.each([{ children: [] }, { children: ['note/preview', 'note/preview'] }, false, null])(
    'forwards malformed JavaScript materialization %j for native validation', async (materialize) => {
      const error = new TypeError('Native materialization validation failed.');
      const observe = vi.fn(async (_path, _request) => { throw error; });
      const { client } = controlledClient(connected(facade(vi.fn(() => ({ records: { observe } })))));
      const hook = renderHook(() => useRecords(childProtocol, 'note', {
        pagination: { limit: 1 }, materialize: materialize as never,
      }), { wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider> });
      await waitFor(() => expect(hook.result.current.status).toBe('error'));
      expect(observe.mock.calls[0]?.[1].materialize).toEqual(materialize);
      expect(hook.result.current.error).toBe(error);
      hook.unmount();
    },
  );

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
