import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const definition = join(root, 'tests/compatibility/react18');
const fixture = join(root, '.artifacts/react18');
const generated = join(fixture, 'generated');
const archive = join(root, '.artifacts/enbox-react.tgz');

mkdirSync(join(root, '.artifacts'), { recursive: true });
execFileSync('bun', ['pm', 'pack', '--ignore-scripts', '--filename', archive, '--quiet'], {
  cwd: root, stdio: 'inherit',
});
// Immutable filenames prevent package managers from reusing an older local
// archive when several iterations share the same package version.
const packed = readFileSync(archive);
const archiveName = `enbox-react-${createHash('sha256').update(packed).digest('hex')}.tgz`;
cpSync(archive, join(root, '.artifacts', archiveName));
rmSync(generated, { recursive: true, force: true });
mkdirSync(join(generated, 'tests'), { recursive: true });
mkdirSync(join(generated, 'type-tests'), { recursive: true });

const manifest = JSON.parse(readFileSync(join(definition, 'package.json'), 'utf8'));
manifest.dependencies['@enbox/react'] = `file:../${archiveName}`;
writeFileSync(join(fixture, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
const compiler = JSON.parse(readFileSync(join(definition, 'tsconfig.json'), 'utf8'));
compiler.extends = '../../tsconfig.json';
writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify(compiler, null, 2) + '\n');
for (const file of ['bunfig.toml', 'vitest.config.ts']) cpSync(join(definition, file), join(fixture, file));

const lock = ts.parseConfigFileTextToJson('bun.lock', readFileSync(join(definition, 'bun.lock'), 'utf8'));
if (lock.error) throw new Error('The React 18 fixture lockfile is invalid.');
const sdk = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const localPackage = lock.config.packages['@enbox/react'];
assert.deepEqual(localPackage[1].dependencies, sdk.dependencies, 'Regenerate the fixture lockfile for changed SDK dependencies.');
assert.deepEqual(localPackage[1].peerDependencies, sdk.peerDependencies, 'Regenerate the fixture lockfile for changed SDK peers.');
lock.config.workspaces[''].dependencies['@enbox/react'] = `file:../${archiveName}`;
localPackage[0] = `@enbox/react@../${archiveName}`;
// The code under test changes; only its archive checksum is refreshed. Every
// registry dependency and integrity remains pinned by the committed lockfile.
localPackage[2] = `sha512-${createHash('sha512').update(packed).digest('base64')}`;
writeFileSync(join(fixture, 'bun.lock'), JSON.stringify(lock.config, null, 2) + '\n');

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
writeFileSync(join(generated, 'type-tests/contracts.tsx'),
  readFileSync(join(root, 'type-tests/contracts.tsx'), 'utf8'));
writeFileSync(join(generated, 'tests/react-version.spec.ts'), `
import { version } from 'react';
import { expect, it } from 'vitest';
it('runs against React 18.3.1', () => { expect(version).toBe('18.3.1'); });
`);
execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: fixture, stdio: 'inherit' });
execFileSync('bun', ['run', 'check'], { cwd: fixture, stdio: 'inherit' });
