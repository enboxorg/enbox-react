// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';

import { useEnboxRecord, useEnboxRecords } from '../src/index.js';
import { protocol, setup } from './record-fixture.js';

it.each(['list', 'record'] as const)('renders a %s query without reads or subscriptions', (kind) => {
  const { wrapper, api, listeners } = setup();
  function List() {
    const state = useEnboxRecords(protocol, 'space/note', { within: 'first' });
    return <output>{state.status}:{state.records.length}</output>;
  }
  function Record() {
    const state = useEnboxRecord(protocol, 'space/note', { within: 'first', recordId: 'selected' });
    return <output>{state.status}:{String(state.isMissing)}</output>;
  }
  const Content = kind === 'list' ? List : Record;
  expect(renderToString(wrapper({ children: <Content /> }))).toBe(kind === 'list'
    ? '<output>idle<!-- -->:<!-- -->0</output>' : '<output>idle<!-- -->:<!-- -->false</output>');
  expect(api.observe).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
