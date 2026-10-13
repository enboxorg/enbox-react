import { Activity } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EnboxProvider, useEnboxClient, useRecordView } from '../src/index.js';
import { defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';
import { ControlledView } from './helpers.js';

describe('React Activity', () => {
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
