import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  EnboxProvider,
  useConnection,
  useEnbox,
  useEnboxMutation,
  useObservableStore,
  useRecordView,
} from '../src/index.js';
import { connected, ControlledView, controlledClient } from './helpers.js';

describe('server shell and hydration', () => {
  it('hydrates an initializing shell even when the browser store already has a session', async () => {
    const { client } = controlledClient(connected());
    const view = new ControlledView(['saved']);
    const opener = vi.fn(async () => view);
    const store = { getSnapshot: () => 7, subscribe: () => () => {} };
    function Status() {
      const connection = useConnection();
      const enbox = useEnbox();
      const mutation = useEnboxMutation(async () => 'ok');
      const records = useRecordView(opener);
      const count = useObservableStore(store, 0);
      return <output>{connection.phase}:{enbox ? 'session' : 'empty'}:{mutation.pendingCount}:{records.status}:{count}</output>;
    }
    const app = <EnboxProvider client={client} initializeOnMount={false}><Status /></EnboxProvider>;
    const html = renderToString(app);
    expect(html).toContain('initializing');
    expect(html).toContain('empty');
    expect(html).toContain('idle');
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
    }
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.listeners.size).toBe(0);
  });
});
