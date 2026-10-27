import { createApplication, defineStore } from '@enbox/browser';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxProvider, useApplication, useFeature, useStore } from '../src/index.js';
import { connected, ControlledView, controlledClient } from './helpers.js';

describe('client application mounting', () => {
  it('reads cached initial state and starts observations only after commit', async () => {
    const { client } = controlledClient(connected());
    const view = new ControlledView(['saved']);
    const opener = vi.fn(async () => view);
    const feature = defineStore({
      create: ({ resource, command }) => ({ items: resource(opener), write: command(async () => 'ok') }),
    });
    const application = createApplication({ stores: { feature }, connection: () => client });
    const store = { getSnapshot: () => 7, subscribe: () => () => {} };
    const initial = application.store(feature);
    expect(initial.items.getSnapshot().status).toBe('idle');
    expect(initial.write.getSnapshot().pendingCount).toBe(0);
    expect(opener).not.toHaveBeenCalled();
    const rendered: string[] = [];
    function Status() {
      const connection = useStore(useApplication().connection);
      const items = useFeature(feature);
      const command = useStore(items.write);
      const records = useStore(items.items);
      const count = useStore(store);
      const state = `${connection.phase}:${command.pendingCount}:${records.status}:${count}`;
      rendered.push(state);
      return <output>{state}</output>;
    }
    const tree = render(<EnboxProvider application={application} initializeOnMount={false}><Status /></EnboxProvider>);
    try {
      expect(rendered[0]).toBe('connected:0:idle:7');
      expect(client.initialize).not.toHaveBeenCalled();
      await waitFor(() => expect(tree.getByText('connected:0:ready:7')).toBeDefined());
      expect(opener).toHaveBeenCalledOnce();
    } finally {
      tree.unmount();
      await application.dispose();
    }
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.listeners.size).toBe(0);
  });
});
