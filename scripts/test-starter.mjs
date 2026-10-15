import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const manifestPath = join(project, 'package.json');
  const lockPath = join(project, 'package-lock.json');
  const manifest = readJson(manifestPath);
  const lock = readJson(lockPath);
  const originalLock = structuredClone(lock);
  const sdkEntry = lock.packages['node_modules/@enbox/react'];
  assert.ok(sdkEntry, 'The starter lockfile must contain the React SDK.');
  assert.equal(manifest.dependencies['@enbox/react'], sdkEntry.version);
  assert.deepEqual(sdkEntry.dependencies, sdk.dependencies);
  assert.deepEqual(sdkEntry.peerDependencies, sdk.peerDependencies);

  const dependency = 'file:' + packedSdk.immutableArchivePath;
  manifest.dependencies['@enbox/react'] = dependency;
  lock.packages[''].dependencies['@enbox/react'] = dependency;
  Object.assign(sdkEntry, {
    name: sdk.name,
    version: sdk.version,
    resolved: dependency,
    integrity: packedSdk.integrity,
  });
  // Registry packages and their integrity stay exactly as committed.
  const unchangedLock = structuredClone(lock);
  unchangedLock.packages[''].dependencies['@enbox/react'] =
    originalLock.packages[''].dependencies['@enbox/react'];
  unchangedLock.packages['node_modules/@enbox/react'] =
    originalLock.packages['node_modules/@enbox/react'];
  assert.deepEqual(unchangedLock, originalLock);
  writeJson(manifestPath, manifest);
  writeJson(lockPath, lock);
  return lock;
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
  execFileSync('npm', ['run', 'build'], { cwd: project, env: environment, stdio: 'inherit' });
  assert.deepEqual(readJson(join(project, 'package-lock.json')), lock, 'The shipped starter lockfile must remain unchanged.');

  const sdk = readJson(join(root, 'package.json'));
  const patchedLock = usePackedSdk(project, packedSdk, sdk);
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: project, env: environment, stdio: 'inherit' });
  assert.deepEqual(readJson(join(project, 'package-lock.json')), patchedLock, 'npm ci must leave the patched lockfile unchanged.');
  assert.equal(readJson(join(project, 'node_modules/@enbox/react/package.json')).version, sdk.version);
  for (const script of ['typecheck', 'build']) {
    execFileSync('npm', ['run', script], { cwd: project, env: environment, stdio: 'inherit' });
  }
  assert.equal(existsSync(join(project, '__fixtures__')), false, 'The generator must not include browser test fixtures.');
  assert.equal(existsSync(join(project, 'dist/__fixtures__')), false, 'The production build must not include browser test fixtures.');
  const fixtures = join(project, '__fixtures__');
  mkdirSync(fixtures);
  for (const [source, destination] of [
    ['session.html', 'session.html'],
    ['session.tsx.fixture', 'session.tsx'],
    ['tsconfig.fixture.json', 'tsconfig.fixture.json'],
    ['protocol.mjs', 'protocol.mjs'],
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
  assert.deepEqual(readFileSync(packedSdk.archivePath), readFileSync(packedSdk.immutableArchivePath),
    'The publish candidate must be the SDK archive tested by the generated app.');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
