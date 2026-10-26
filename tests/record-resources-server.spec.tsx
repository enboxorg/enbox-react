// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';

import { createRecordsStore } from '../src/config/index.js';
import { useEnboxRecords } from '../src/index.js';
import { protocol, setup } from './record-fixture.js';

it.each(['parameters', 'supplied'] as const)('renders %s record sources without reads or subscriptions', (source) => {
  const { client, wrapper, api, listeners } = setup();
  const store = createRecordsStore({ client, protocol, path: 'space' });
  function Supplied() {
    const state = useEnboxRecords(store);
    return <output>{state.status}:{state.records.length}</output>;
  }
  function Parameterized() {
    const state = useEnboxRecords(protocol, 'space');
    return <output>{state.status}:{state.records.length}</output>;
  }
  const Content = source === 'supplied' ? Supplied : Parameterized;
  expect(renderToString(wrapper({ children: <Content /> }))).toContain('idle<!-- -->:<!-- -->0');
  expect(api.observe).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
