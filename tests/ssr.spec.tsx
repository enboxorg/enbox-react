import type { ConnectionSnapshot } from '@enbox/browser';

import { createApplication, defineStore } from '@enbox/browser';
import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EnboxProvider, useApplication, useFeature, useStore } from '../src/index.js';
import { connected, ControlledView, controlledClient } from './helpers.js';

const SERVER_CONNECTION: ConnectionSnapshot = Object.freeze({ phase: 'initializing' });

describe('server shell and hydration', () => {
  it('hydrates an initializing shell before borrowing connected resources', async () => {
    const { client } = controlledClient(connected());
    const view = new ControlledView(['saved']);
    const opener = vi.fn(async () => view);
    const feature = defineStore({
      protocols: {},
      create: ({ resource, command }) => ({ items: resource(opener), write: command(async () => 'ok') }),
    });
    const application = createApplication({ stores: { feature }, connection: () => client });
    const store = { getSnapshot: () => 7, subscribe: () => () => {} };
    function Status() {
      const runtime = useApplication();
      const connection = useStore(runtime.connection, { fallback: SERVER_CONNECTION });
      const items = useFeature(feature);
      const command = useStore(items.write);
      const records = useStore(items.items);
      const count = useStore(store, { fallback: 0 });
      return <output>{connection.phase}:{connection.enbox ? 'session' : 'empty'}:{command.pendingCount}:{records.status}:{count}</output>;
    }
    const app = <EnboxProvider application={application} initializeOnMount={false}><Status /></EnboxProvider>;
    const html = renderToString(app);
    expect(client.initialize).not.toHaveBeenCalled();
    expect(opener).not.toHaveBeenCalled();
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = html;
    expect(container.textContent).toBe('initializing:empty:0:idle:0');
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, app, { onRecoverableError: recoverable }); });
      expect(container.textContent).toBe('connected:session:0:ready:7');
      expect(opener).toHaveBeenCalledOnce();
      expect(recoverable).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      await application.dispose();
    }
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.listeners.size).toBe(0);
  });
});
