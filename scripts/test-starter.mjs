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
  const source = process.env.ENBOX_STARTER_SDK_SOURCE ?? 'packed';
  assert.ok(source === 'packed' || source === 'registry', 'SDK source must be packed or registry.');
  const environment = {
    ...process.env,
    npm_config_cache: join(temporaryRoot, 'npm-cache'),
    ENBOX_STARTER_DIR: project,
    ENBOX_STARTER_APP_NAME: displayName,
  };
  for (const manager of ['npm', 'bun']) {
    const directory = manager === 'npm' ? project : join(temporaryRoot, 'Bun dapp');
    execFileSync(manager === 'bun' ? 'bun' : process.execPath,
      [join(generatorRoot, generator.bin['create-dapp']), directory, '--package-manager', manager], {
        cwd: temporaryRoot, env: environment, stdio: 'inherit',
      });
    assert.equal(existsSync(join(directory, 'package-lock.json')), false);
    assert.equal(existsSync(join(directory, 'bun.lock')), false);
    const manifest = readJson(join(directory, 'package.json'));
    if (manager === 'npm') {
      assert.equal(manifest.name, packageName);
      assert.equal(manifest.private, true);
      const app = readJson(join(directory, 'src/app.json'));
      assert.equal(app.id, packageName);
      assert.equal(app.name, displayName);
    }
    if (source === 'packed') {
      // Pre-release checks install exactly the archive the SDK workflow publishes.
      manifest.dependencies['@enbox/react'] = 'file:' + packedSdk.immutableArchivePath;
      writeJson(join(directory, 'package.json'), manifest);
    }
    execFileSync(manager, ['install', ...(manager === 'npm' ? ['--no-audit', '--no-fund'] : [])], {
      cwd: directory, env: environment, stdio: 'inherit',
    });
    execFileSync(manager, ['audit', ...(manager === 'npm' ? ['--audit-level=low'] : [])], {
      cwd: directory, env: environment, stdio: 'inherit',
    });
    execFileSync(manager, ['run', 'build'], { cwd: directory, env: environment, stdio: 'inherit' });
    const lockPath = join(directory, manager === 'npm' ? 'package-lock.json' : 'bun.lock');
    const lock = readFileSync(lockPath, 'utf8');
    execFileSync(manager, manager === 'npm' ? ['ci', '--no-audit', '--no-fund'] : ['install', '--frozen-lockfile'], {
      cwd: directory, env: environment, stdio: 'inherit',
    });
    assert.equal(readFileSync(lockPath, 'utf8'), lock, 'The created lockfile must support a reproducible install.');
    assert.equal(existsSync(join(directory, manager === 'npm' ? 'bun.lock' : 'package-lock.json')), false);
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
