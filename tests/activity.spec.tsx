import type { ContextView } from '@enbox/browser';

import { Activity, useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxBindingChangedError, EnboxProvider, useContextView, useEnboxClient, useEnboxConnection, useEnboxMutation, useRecordView } from '../src/index.js';
import { defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';
import { connected, controlledClient, ControlledView, deferred } from './helpers.js';
import { protocol as recordProtocol, setup as recordSetup } from './record-fixture.js';
import { useEnboxRecords } from '../src/index.js';

describe('React Activity', () => {
  it('reopens parameterized record views and keeps retired mutation guards obsolete', async () => {
    const { client, api } = recordSetup<{ name: string }>();
    const views: ControlledView<{ record: { id: string; contextId: string }; value: { name: string } }>[] = [];
    api.observe.mockImplementation(async () => {
      const view = new ControlledView<{ record: { id: string; contextId: string }; value: { name: string } }>();
      views.push(view);
      return view;
    });
    const guards: (() => boolean)[] = [];
    function Content() {
      const state = useEnboxRecords(recordProtocol, 'space');
      guards.push(state.create.isCurrent);
      return <output>{state.status}</output>;
    }
    const children = <Content />;
    const element = (mode: 'visible' | 'hidden') => <EnboxProvider client={client}><Activity mode={mode}>{children}</Activity></EnboxProvider>;
    const tree = render(element('visible'));
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    const captured = guards.at(-1)!;
    tree.rerender(element('hidden'));
    expect(views[0]!.close).toHaveBeenCalledOnce();
    expect(captured()).toBe(false);
    tree.rerender(element('visible'));
    await waitFor(() => expect(views).toHaveLength(2));
    await waitFor(() => expect(guards.at(-1)!()).toBe(true));
    expect(captured()).toBe(false);
    tree.unmount();
    expect(views[1]!.close).toHaveBeenCalledOnce();
  });
  it('gives resumed child Effects a fresh borrowed workflow even when children are unchanged', async () => {
    const { client } = controlledClient();
    const errors: unknown[] = [];
    let effects = 0;
    function Content() {
      const connection = useEnboxConnection();
      useEffect(() => {
        effects += 1;
        void connection.connect().catch((cause: unknown) => { errors.push(cause); });
      }, []);
      return null;
    }
    const children = <EnboxProvider client={client} initializeOnMount={false}><Content /></EnboxProvider>;
    const tree = render(<Activity mode="visible">{children}</Activity>);
    await waitFor(() => expect(client.connect).toHaveBeenCalledOnce());
    await act(async () => {
      tree.rerender(<Activity mode="hidden">{children}</Activity>);
      await Promise.resolve();
    });
    await act(async () => {
      tree.rerender(<Activity mode="visible">{children}</Activity>);
      await Promise.resolve();
    });
    expect(effects).toBe(2);
    expect(errors).toEqual([]);
    expect(client.connect).toHaveBeenCalledTimes(2);
    tree.unmount();
  });

  it('gives resumed child Effects a usable owned client before their native actions run', async () => {
    const config = { application: defineApplicationManifest({ protocols: [defineProtocol({
      protocol: 'https://activity.test/native-effects', published: false,
      types: { note: { dataFormats: ['application/json'] } }, structure: { note: {} },
    } as const, { note: recordCodecs.json() })] }) };
    const clients: ReturnType<typeof useEnboxClient>[] = [];
    const errors: unknown[] = [];
    function Content() {
      const client = useEnboxClient();
      useEffect(() => {
        clients.push(client);
        // A native disconnect on an inert client needs no AuthManager. Like
        // initialize(), it throws synchronously if the old client was disposed.
        try { void client.disconnect().catch((cause: unknown) => { errors.push(cause); }); }
        catch (cause: unknown) { errors.push(cause); }
      }, []);
      return null;
    }
    const children = <EnboxProvider config={config} initializeOnMount={false}><Content /></EnboxProvider>;
    const tree = render(<Activity mode="visible">{children}</Activity>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      tree.rerender(<Activity mode="hidden">{children}</Activity>);
      await Promise.resolve();
    });
    await act(async () => {
      tree.rerender(<Activity mode="visible">{children}</Activity>);
      await Promise.resolve();
    });
    expect(errors).toEqual([]);
    expect(clients).toHaveLength(2);
    expect(clients[1]).not.toBe(clients[0]);
    tree.unmount();
  });

  it('resumes a borrowed client with a fresh workflow while retired guards stay obsolete', async () => {
    const { client } = controlledClient(connected());
    const saving = deferred<void>();
    const beforeConnect = vi.fn().mockReturnValueOnce(saving.promise).mockResolvedValue(undefined);
    let connection!: ReturnType<typeof useEnboxConnection>;
    function Content() { connection = useEnboxConnection(); return <output>{connection.isConnecting ? 'waiting' : 'ready'}</output>; }
    const element = (mode: 'visible' | 'hidden') => <Activity mode={mode}>
      <EnboxProvider client={client} beforeConnect={beforeConnect}><Content /></EnboxProvider>
    </Activity>;
    const tree = render(element('visible'));
    const retired = connection;
    let pending!: Promise<void>;
    act(() => { pending = retired.connect(); });
    const rejected = expect(pending).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { tree.rerender(element('hidden')); await Promise.resolve(); });
    await rejected;
    await expect(retired.connect()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    tree.rerender(element('visible'));
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    expect(connection.connect).not.toBe(retired.connect);
    await act(async () => { await connection.connect(); });
    expect(client.connect).toHaveBeenCalledOnce();
    await act(async () => { saving.resolve(); await Promise.resolve(); });
    expect(client.connect).toHaveBeenCalledOnce();
    await expect(retired.connect()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(client.dispose).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('reopens a context catalog when retained effects resume', async () => {
    const closes: ReturnType<typeof vi.fn<() => Promise<void>>>[] = [];
    const open = async () => {
      const state = Object.freeze({ status: 'ready' as const, contexts: Object.freeze(['visible']) });
      const close = vi.fn(async () => {});
      closes.push(close);
      return {
        getSnapshot: () => state, subscribe: () => () => {}, ready: async () => state, close,
      } satisfies ContextView<string>;
    };
    function Content() {
      const state = useContextView(open);
      return <output>{state.status}</output>;
    }
    const tree = render(<Activity mode="visible"><Content /></Activity>);
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    tree.rerender(<Activity mode="hidden"><Content /></Activity>);
    expect(closes[0]).toHaveBeenCalledOnce();
    tree.rerender(<Activity mode="visible"><Content /></Activity>);
    await waitFor(() => expect(closes.length).toBe(2));
    await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
    tree.unmount();
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true);
  });

  it('replaces a retired owned client when Effects resume', async () => {
    const clients: ReturnType<typeof useEnboxClient>[] = [];
    function Content() {
      const client = useEnboxClient();
      if (!clients.includes(client)) clients.push(client);
      return <output>{client.getSnapshot().phase}</output>;
    }
    const config = { application: defineApplicationManifest({ protocols: [defineProtocol({
      protocol: 'https://activity.test/notes', published: false,
      types: { note: { dataFormats: ['application/json'] } }, structure: { note: {} },
    } as const, { note: recordCodecs.json() })] }) };
    const tree = render(<Activity mode="visible"><EnboxProvider config={config} initializeOnMount={false}><Content /></EnboxProvider></Activity>);
    const first = clients[0]!;
    await act(async () => {
      tree.rerender(<Activity mode="hidden"><EnboxProvider config={config} initializeOnMount={false}><Content /></EnboxProvider></Activity>);
      await Promise.resolve();
    });
    tree.rerender(<Activity mode="visible"><EnboxProvider config={config} initializeOnMount={false}><Content /></EnboxProvider></Activity>);
    await waitFor(() => expect(clients.length).toBe(2));
    expect(clients[1]).not.toBe(first);
    expect(clients[1]!.getSnapshot().phase).toBe('initializing');
    tree.unmount();
  });
  it('keeps an old mutation UI guard retired after the same view resumes', async () => {
    const { client } = controlledClient(connected());
    const write = deferred<string>();
    const controls: ReturnType<typeof useEnboxMutation<void, string>>[] = [];
    const operation = async () => write.promise;
    function Content() {
      const mutation = useEnboxMutation(operation);
      controls.push(mutation);
      return <output>{mutation.isPending ? 'pending' : 'idle'}</output>;
    }
    const content = <Content />;
    const tree = render(<EnboxProvider client={client}><Activity mode="visible">{content}</Activity></EnboxProvider>);
    const captured = controls.at(-1)!;
    let issued!: Promise<string>;
    act(() => { issued = captured.mutateAsync(); });
    tree.rerender(<EnboxProvider client={client}><Activity mode="hidden">{content}</Activity></EnboxProvider>);
    expect(captured.isCurrent()).toBe(false);
    tree.rerender(<EnboxProvider client={client}><Activity mode="visible">{content}</Activity></EnboxProvider>);
    await waitFor(() => expect(controls.at(-1)!.isCurrent()).toBe(true));
    await act(async () => { write.resolve('saved'); await issued; });
    expect(captured.isCurrent()).toBe(false);
    expect(controls.at(-1)!.isCurrent()).toBe(true);
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
});
