// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

import { EnboxProvider, useEnboxResource } from '../src/index.js';
import { connected, controlledClient } from './helpers.js';

it('renders a resource shell without initialization even for a connected supplied client', () => {
  const { client, listeners } = controlledClient(connected());
  const open = vi.fn(async () => ({ close: vi.fn() }));
  function Content() {
    const resource = useEnboxResource(open);
    return <output>{resource.status}</output>;
  }
  expect(renderToString(<EnboxProvider client={client} initializeOnMount={false}><Content /></EnboxProvider>)).toBe('<output>idle</output>');
  expect(open).not.toHaveBeenCalled();
  expect(client.initialize).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
