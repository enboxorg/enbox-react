import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const publicFunctions = [
  'EnboxProvider', 'useApplication', 'useFeature', 'useStore',
  'useEnboxConnection', 'useProfile', 'useProfiles',
];

test('the public JavaScript and declaration entrypoints exist', () => {
  for (const path of Object.values(manifest.exports['.'])) {
    assert.ok(statSync(new URL(path, root)).isFile(), path);
  }
});

test('the React entrypoint preserves its client boundary', () => {
  const react = readFileSync(new URL(manifest.exports['.'].import, root), 'utf8');
  assert.match(react, /^["']use client["'];/);
});

test('the built package imports its complete React surface without browser globals', async () => {
  assert.equal(typeof window, 'undefined');
  const react = await import('@enbox/react');
  assert.deepEqual(Object.keys(react).sort(), [...publicFunctions].sort());
  for (const name of publicFunctions) assert.equal(typeof react[name], 'function', name);
  await assert.rejects(import('@enbox/react/config'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
