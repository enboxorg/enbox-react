import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { packSdk } from './pack-sdk.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, '.artifacts');
const generatorArchive = join(artifacts, 'create-dapp.tgz');
const displayName = 'My dapp';
const packageName = 'my-dapp';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function usePackedSdk(project, packedSdk, sdk) {
  const fixture = join(root, 'tests/compatibility/starter');
  const manifestPath = join(project, 'package.json');
  const manifest = readJson(manifestPath);
  const candidate = readJson(join(fixture, 'package.json'));
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (candidate[section] === undefined) delete manifest[section];
    else manifest[section] = { ...candidate[section] };
  }
  const parsed = ts.parseConfigFileTextToJson('bun.lock', readFileSync(join(fixture, 'bun.lock'), 'utf8'));
  if (parsed.error) throw new Error('The starter candidate lockfile is invalid.');
  const lock = parsed.config;
  const sdkEntry = lock.packages['@enbox/react'];
  assert.ok(sdkEntry, 'The starter candidate lockfile must contain the React SDK.');
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(sdkEntry[1][section], sdk[section], `Regenerate the starter candidate lockfile for changed SDK ${section}.`);
  }

  const dependency = 'file:' + packedSdk.immutableArchivePath;
  manifest.dependencies['@enbox/react'] = dependency;
  lock.workspaces[''].name = manifest.name;
  lock.workspaces[''].dependencies['@enbox/react'] = dependency;
  sdkEntry[0] = '@enbox/react@' + packedSdk.immutableArchivePath;
  sdkEntry[2] = packedSdk.integrity;
  // Candidate upgrades use their own registry graph, without changing the shipped starter.
  rmSync(join(project, 'node_modules'), { recursive: true, force: true });
  rmSync(join(project, 'package-lock.json'));
  writeJson(manifestPath, manifest);
  const lockfile = JSON.stringify(lock, null, 2) + '\n';
  writeFileSync(join(project, 'bun.lock'), lockfile);
  return lockfile;
}

mkdirSync(artifacts, { recursive: true });
const packedSdk = packSdk(root);
execFileSync('bun', ['pm', 'pack', '--ignore-scripts', '--filename', generatorArchive, '--quiet'], {
  cwd: join(root, 'packages/create-dapp'), stdio: 'inherit',
});
const temporaryRoot = mkdtempSync(join(tmpdir(), 'enbox-create-dapp-'));
try {
  const project = join(temporaryRoot, displayName);
  const parentFromRepo = relative(realpathSync(root), realpathSync(temporaryRoot));
  assert.ok(parentFromRepo.startsWith('..' + sep), 'Verify the starter outside the repository.');
  const extracted = join(temporaryRoot, 'generator');
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', generatorArchive, '-C', extracted], { stdio: 'inherit' });
  const generatorRoot = join(extracted, 'package');
  const generator = readJson(join(generatorRoot, 'package.json'));
  assert.equal(generator.name, '@enbox/create-dapp');
  assert.equal(generator.bin['create-dapp'], 'bin/create-dapp.mjs');
  execFileSync(process.execPath, [join(generatorRoot, generator.bin['create-dapp']), project], {
    cwd: temporaryRoot, stdio: 'inherit',
  });

  const manifest = readJson(join(project, 'package.json'));
  const lock = readJson(join(project, 'package-lock.json'));
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.private, true);
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, packageName);
  assert.equal(lock.packages[''].name, packageName);
  const app = readJson(join(project, 'src/app.json'));
  assert.equal(app.id, packageName);
  assert.equal(app.name, displayName);
  assert.ok(readFileSync(join(project, '.gitignore'), 'utf8').includes('node_modules'));

  const environment = {
    ...process.env,
    npm_config_cache: join(temporaryRoot, 'npm-cache'),
    ENBOX_STARTER_DIR: project,
    ENBOX_STARTER_APP_NAME: displayName,
  };
  // First verify exactly what the published generator installs.
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: project, env: environment, stdio: 'inherit' });
  execFileSync('npm', ['audit', '--audit-level=low'], { cwd: project, env: environment, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: project, env: environment, stdio: 'inherit' });
  assert.deepEqual(readJson(join(project, 'package-lock.json')), lock, 'The shipped starter lockfile must remain unchanged.');

  const sdk = readJson(join(root, 'package.json'));
  const patchedLock = usePackedSdk(project, packedSdk, sdk);
  execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: project, env: environment, stdio: 'inherit' });
  execFileSync('bun', ['audit'], { cwd: project, env: environment, stdio: 'inherit' });
  assert.equal(readFileSync(join(project, 'bun.lock'), 'utf8'), patchedLock, 'Bun must leave the candidate lockfile unchanged.');
  assert.equal(readJson(join(project, 'node_modules/@enbox/react/package.json')).version, sdk.version);
  execFileSync('npm', ['run', 'build'], { cwd: project, env: environment, stdio: 'inherit' });
  assert.equal(existsSync(join(project, '__fixtures__')), false, 'The generator must not include browser test fixtures.');
  assert.equal(existsSync(join(project, 'dist/__fixtures__')), false, 'The production build must not include browser test fixtures.');
  const fixtures = join(project, '__fixtures__');
  mkdirSync(fixtures);
  for (const [source, destination] of [
    ['session.html', 'session.html'],
    ['session.tsx.fixture', 'session.tsx'],
    ['tsconfig.fixture.json', 'tsconfig.fixture.json'],
    ['protocol.mjs', 'protocol.mjs'],
    ['workers.mjs', 'workers.mjs'],
  ]) {
    cpSync(join(root, 'tests/browser/fixtures', source), join(fixtures, destination));
  }
  execFileSync(process.execPath, [
    join(project, 'node_modules/typescript/bin/tsc'), '--noEmit', '--project', join(fixtures, 'tsconfig.fixture.json'),
  ], { cwd: project, env: environment, stdio: 'inherit' });
  execFileSync(process.execPath, [join(fixtures, 'protocol.mjs')], {
    cwd: project, env: environment, stdio: 'inherit',
  });
  execFileSync(process.execPath, [
    join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', join(root, 'playwright.config.ts'),
  ], { cwd: root, env: environment, stdio: 'inherit' });
  execFileSync(process.execPath, [join(fixtures, 'workers.mjs')], {
    cwd: project, env: environment, stdio: 'inherit',
  });
  assert.deepEqual(readFileSync(packedSdk.archivePath), readFileSync(packedSdk.immutableArchivePath),
    'The publish candidate must be the SDK archive tested by the generated app.');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
