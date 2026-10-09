import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('every public JavaScript and declaration entrypoint exists', () => {
  for (const entrypoint of ['.', './config']) {
    for (const path of Object.values(manifest.exports[entrypoint])) {
      assert.ok(statSync(new URL(path, root)).isFile(), path);
    }
  }
});

test('the React entrypoint preserves its client boundary', () => {
  const react = readFileSync(new URL(manifest.exports['.'].import, root), 'utf8');
  const config = readFileSync(new URL(manifest.exports['./config'].import, root), 'utf8');
  assert.match(react, /^['"]use client['"];/);
  assert.doesNotMatch(config, /^['"]use client['"];/);
});

test('the built package imports without browser globals and leaves client startup explicit', async () => {
  assert.equal(typeof window, 'undefined');
  const react = await import('@enbox/react');
  const config = await import('@enbox/react/config');
  for (const name of [
    'EnboxProvider', 'useEnboxClient', 'useConnection', 'useConnectionActions',
    'useEnbox', 'useIdentity', 'useSyncStatus', 'useProtocol',
    'useRecords', 'useRecordView', 'useObservableStore', 'useEnboxMutation',
  ]) {
    assert.equal(typeof react[name], 'function', name);
  }
  const protocol = config.defineProtocol({
    protocol: 'https://package.example.test/notes',
    published: false,
    types: { note: { dataFormats: ['application/json'] } },
    structure: { note: {} },
  }, { note: config.recordCodecs.json() });
  const client = config.createEnboxClient({
    application: config.defineApplicationManifest({ protocols: [protocol] }),
  });
  try {
    assert.equal(client.getSnapshot().phase, 'initializing');
  } finally {
    await client.dispose();
  }
});
