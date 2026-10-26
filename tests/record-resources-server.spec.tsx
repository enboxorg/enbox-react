// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';

import { createRecordStore, defineRecordStore } from '../src/config/index.js';
import { EnboxRecordsProvider, useEnboxRecords } from '../src/index.js';
import { protocol, setup } from './record-fixture.js';

it.each(['definition', 'supplied'] as const)('renders %s record sources without reads or subscriptions', (source) => {
  const { client, wrapper, api, listeners } = setup();
  const spaces = defineRecordStore({ protocol, path: 'space' });
  const records = { spaces: source === 'definition' ? spaces : createRecordStore(spaces, { client }) };
  function Content() {
    const state = useEnboxRecords(spaces);
    return <output>{state.status}:{state.records.length}</output>;
  }
  expect(renderToString(wrapper({ children: <EnboxRecordsProvider records={records}><Content /></EnboxRecordsProvider> }))).toContain('idle<!-- -->:<!-- -->0');
  expect(api.observe).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
