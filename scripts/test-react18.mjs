import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { packSdk } from './pack-sdk.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const template = join(root, 'tests/compatibility/react18');
const consumer = join(root, '.artifacts/react18');
const generated = join(consumer, 'generated');
const { archiveName, integrity } = packSdk(root);
rmSync(generated, { recursive: true, force: true });
mkdirSync(join(generated, 'tests'), { recursive: true });
mkdirSync(join(generated, 'type-tests'), { recursive: true });

const manifest = JSON.parse(readFileSync(join(template, 'package.json'), 'utf8'));
manifest.dependencies['@enbox/react'] = `file:../${archiveName}`;
writeFileSync(join(consumer, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
const tsconfig = JSON.parse(readFileSync(join(template, 'tsconfig.json'), 'utf8'));
tsconfig.extends = '../../tsconfig.json';
writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');
for (const file of ['bunfig.toml', 'vitest.config.ts']) cpSync(join(template, file), join(consumer, file));

const lock = ts.parseConfigFileTextToJson('bun.lock', readFileSync(join(template, 'bun.lock'), 'utf8'));
if (lock.error) throw new Error('The React 18 fixture lockfile is invalid.');
const sdk = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const localPackage = lock.config.packages['@enbox/react'];
assert.deepEqual(localPackage[1].dependencies, sdk.dependencies, 'Regenerate the fixture lockfile for changed SDK dependencies.');
assert.deepEqual(localPackage[1].peerDependencies, sdk.peerDependencies, 'Regenerate the fixture lockfile for changed SDK peers.');
lock.config.workspaces[''].dependencies['@enbox/react'] = `file:../${archiveName}`;
localPackage[0] = `@enbox/react@../${archiveName}`;
// The code under test changes; only its archive checksum is refreshed. Every
// registry dependency and integrity remains pinned by the committed lockfile.
localPackage[2] = integrity;
writeFileSync(join(consumer, 'bun.lock'), JSON.stringify(lock.config, null, 2) + '\n');

for (const entry of readdirSync(join(root, 'tests'), { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || entry.name === 'activity.spec.tsx') continue;
  const original = readFileSync(join(root, 'tests', entry.name), 'utf8');
  const installed = original.replace(/(['"])\.\.\/src\/([^'"]+)\.js\1/g, (_match, quote, module) => {
    const target = module === 'index' ? '@enbox/react'
      : module === 'config/index' ? '@enbox/react/config'
      : `../../node_modules/@enbox/react/dist/${module}.js`;
    return `${quote}${target}${quote}`;
  });
  writeFileSync(join(generated, 'tests', entry.name), installed);
}
for (const entry of readdirSync(join(root, 'type-tests'), { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
  cpSync(join(root, 'type-tests', entry.name), join(generated, 'type-tests', entry.name));
}
writeFileSync(join(generated, 'tests/react-version.spec.ts'), `
import { version } from 'react';
import { expect, it } from 'vitest';
it('runs against React 18.3.1', () => { expect(version).toBe('18.3.1'); });
`);
execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: consumer, stdio: 'inherit' });
execFileSync('bun', ['run', 'check'], { cwd: consumer, stdio: 'inherit' });
