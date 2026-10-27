import type { ContextView } from '@enbox/browser';

import { createApplication, defineStore } from '@enbox/browser';
import { Activity, useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxBindingChangedError } from '../src/errors.js';
import { EnboxProvider, useEnboxConnection, useFeature, useStore } from '../src/index.js';
import { applicationFor, connected, controlledClient, ControlledView, deferred } from './helpers.js';

describe('React Activity', () => {
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
    const children = <EnboxProvider application={applicationFor(client)} initializeOnMount={false}><Content /></EnboxProvider>;
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

  it('resumes a borrowed client with a fresh workflow while retired guards stay obsolete', async () => {
    const { client } = controlledClient(connected());
    const saving = deferred<void>();
    const beforeConnect = vi.fn().mockReturnValueOnce(saving.promise).mockResolvedValue(undefined);
    let connection!: ReturnType<typeof useEnboxConnection>;
    function Content() { connection = useEnboxConnection(); return <output>{connection.isConnecting ? 'waiting' : 'ready'}</output>; }
    const element = (mode: 'visible' | 'hidden') => <Activity mode={mode}>
      <EnboxProvider application={applicationFor(client)} beforeConnect={beforeConnect}><Content /></EnboxProvider>
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

  it.each(['records', 'contexts'] as const)('releases and resumes a borrowed %s source through Activity', async (kind) => {
    const closes: ReturnType<typeof vi.fn<() => Promise<void>>>[] = [];
    const open = vi.fn(async () => {
      if (kind === 'records') {
        const view = new ControlledView(['visible']);
        closes.push(view.close);
        return view;
      }
      const state = Object.freeze({ status: 'ready' as const, contexts: Object.freeze(['visible']) });
      const close = vi.fn(async () => {});
      closes.push(close);
      return {
        getSnapshot: () => state, subscribe: () => () => {}, ready: async () => state, close,
      } satisfies ContextView<string>;
    });
    const feature = defineStore({ protocols: {}, create: ({ resource }) => ({ items: resource(open) }) });
    const { client } = controlledClient(connected());
    const application = createApplication({ stores: { feature }, connection: () => client });
    function Content() { return <output>{useStore(useFeature(feature).items).status}</output>; }
    const children = <EnboxProvider application={application} initializeOnMount={false}><Content /></EnboxProvider>;
    const tree = render(<Activity mode="visible">{children}</Activity>);
    try {
      await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
      expect(open).toHaveBeenCalledOnce();
      await act(async () => { tree.rerender(<Activity mode="hidden">{children}</Activity>); });
      expect(closes[0]).toHaveBeenCalledOnce();
      await act(async () => { tree.rerender(<Activity mode="visible">{children}</Activity>); });
      await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(tree.getByText('ready')).toBeDefined());
      expect(client.dispose).not.toHaveBeenCalled();
    } finally {
      tree.unmount();
      await application.dispose();
    }
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true);
  });
});
