import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = join(packageRoot, 'bin/create-dapp.mjs');
const template = join(packageRoot, 'template');

function sandbox(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'create-dapp-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(args, cwd, { executable = cli, imports = [], env = {} } = {}) {
  const result = spawnSync(process.execPath, [...imports.flatMap((path) => ['--import', pathToFileURL(path).href]), executable, ...args], {
    cwd, encoding: 'utf8', timeout: 5_000, env: { ...process.env, npm_config_user_agent: '', ...env },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function json(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }

test('help and version work without prompting or creating files', (t) => {
  const directory = sandbox(t);
  for (const flag of ['--help', '-h']) {
    const result = run([flag], directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /npm create @enbox\/dapp@latest/);
    assert.match(result.stdout, /npx @enbox\/create-dapp@latest/);
    assert.equal(result.stderr, '');
  }
  for (const flag of ['--version', '-v']) {
    const result = run([flag], directory);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), json(join(packageRoot, 'package.json')).version);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('noninteractive invocation requires a directory instead of waiting for input', (t) => {
  const directory = sandbox(t);
  const result = run([], directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Provide a target directory/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.equal(result.stdout, '');
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('refuses malformed arguments and unsupported force options without writing', (t) => {
  const directory = sandbox(t);
  for (const args of [[''], ['   '], ['bad\nname'], ['one', 'two'], ['--force'], ['--unknown']]) {
    const result = run(args, directory);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /create-dapp:/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('refuses nonempty destinations, including directories containing only hidden files', (t) => {
  const directory = sandbox(t);
  for (const file of ['keep.txt', '.keep']) {
    const destination = join(directory, file === '.keep' ? 'hidden' : 'visible');
    fs.mkdirSync(destination);
    fs.writeFileSync(join(destination, file), 'user content');
    const result = run([destination], directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not empty/);
    assert.deepEqual(fs.readdirSync(destination), [file]);
    assert.equal(fs.readFileSync(join(destination, file), 'utf8'), 'user content');
  }
});

test('refuses a file destination without modifying it', (t) => {
  const directory = sandbox(t);
  const destination = join(directory, 'keep.txt');
  fs.writeFileSync(destination, 'user content');
  const result = run([destination], directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a directory/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'user content');
});

test('refuses existing and dangling symlink destinations', { skip: process.platform === 'win32' }, (t) => {
  const directory = sandbox(t);
  const real = join(directory, 'real');
  fs.mkdirSync(real);
  for (const [name, target] of [['linked', real], ['dangling', join(directory, 'missing')]]) {
    const destination = join(directory, name);
    fs.symlinkSync(target, destination, 'dir');
    const result = run([destination], directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /symbolic link/);
    assert.equal(fs.lstatSync(destination).isSymbolicLink(), true);
  }
  assert.deepEqual(fs.readdirSync(real), []);
  assert.equal(fs.existsSync(join(directory, 'missing')), false);
});

test('generates the bundled template with display and npm names kept in JSON', (t) => {
  const directory = sandbox(t);
  const destination = join(directory, 'Mý Fantastic App!');
  const originalPackage = fs.readFileSync(join(template, 'package.json'), 'utf8');
  const result = run([destination], directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(json(join(destination, 'package.json')).name, 'my-fantastic-app');
  assert.equal(fs.existsSync(join(destination, 'package-lock.json')), false);
  assert.equal(fs.existsSync(join(destination, 'bun.lock')), false);
  assert.equal(json(join(destination, 'src/app.json')).id, 'my-fantastic-app');
  assert.equal(json(join(destination, 'src/app.json')).name, basename(destination));
  for (const path of ['index.html', 'tsconfig.json', 'vite.config.ts', 'src/main.tsx', 'src/App.tsx', '.gitignore']) {
    assert.equal(fs.statSync(join(destination, path)).isFile(), true, path);
  }
  assert.equal(fs.existsSync(join(destination, '_gitignore')), false);
  assert.equal(fs.readFileSync(join(destination, '.gitignore'), 'utf8'), fs.readFileSync(join(template, '_gitignore'), 'utf8'));
  assert.equal(fs.readFileSync(join(destination, 'src/main.tsx'), 'utf8'), fs.readFileSync(join(template, 'src/main.tsx'), 'utf8'));
  assert.equal(fs.readFileSync(join(template, 'package.json'), 'utf8'), originalPackage);
  assert.match(result.stdout, /npm install\n  npm run dev/);
  assert.equal(fs.existsSync(join(destination, 'node_modules')), false);
  assert.equal(fs.existsSync(join(destination, '.git')), false);
});

for (const manager of ['npm', 'bun']) {
  test(`detects ${manager}, prints its commands, and leaves lockfile creation to the first install`, (t) => {
    const directory = sandbox(t);
    const destination = join(directory, 'app');
    const result = run([destination], directory, { env: { npm_config_user_agent: `${manager}/1.4.4 other/1.0.0` } });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`${manager} install\n  ${manager} run dev`));
    assert.equal(fs.existsSync(join(destination, 'package-lock.json')), false);
    assert.equal(fs.existsSync(join(destination, 'bun.lock')), false);
    assert.equal(fs.existsSync(join(destination, 'node_modules')), false);
  });
  test(`allows an explicit ${manager} override`, (t) => {
    const directory = sandbox(t);
    const result = run(['app', '--package-manager', manager], directory, {
      env: { npm_config_user_agent: manager === 'bun' ? 'npm/11.0.0' : 'bun/1.4.4' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`${manager} install\n  ${manager} run dev`));
  });
}

test('rejects unsupported package managers before writing', (t) => {
  const directory = sandbox(t);
  const result = run(['app', '--package-manager', 'yarn'], directory);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('supports an empty current directory and nested new destinations', (t) => {
  const directory = sandbox(t);
  const existing = join(directory, 'existing');
  fs.mkdirSync(existing);
  assert.equal(run(['.'], existing).status, 0);
  assert.equal(json(join(existing, 'src/app.json')).name, 'existing');
  const destination = join(directory, 'nested', 'new-app');
  const result = run([destination], directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(json(join(destination, 'package.json')).name, 'new-app');
});

test('uses a valid fallback npm name when the basename has no npm characters', (t) => {
  const directory = sandbox(t);
  const destination = join(directory, '✨');
  const result = run([destination], directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(json(join(destination, 'package.json')).name, 'enbox-dapp');
  assert.equal(json(join(destination, 'src/app.json')).id, 'enbox-dapp');
  assert.equal(json(join(destination, 'src/app.json')).name, '✨');
});

test('prints a shell-quoted cd command for spaces, quotes and expansion syntax', { skip: process.platform === 'win32' }, (t) => {
  const directory = sandbox(t);
  const destination = join(directory, "App 'name' $CREATE_DAPP_TEST $(printf bad)");
  const result = run([destination], directory);
  assert.equal(result.status, 0, result.stderr);
  const command = result.stdout.split('\n').find((line) => line.startsWith('  cd '));
  assert.ok(command);
  const shell = spawnSync('/bin/sh', ['-c', `${command}\npwd`], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, CREATE_DAPP_TEST: 'expanded' },
  });
  assert.equal(shell.status, 0, shell.stderr);
  assert.equal(shell.stdout.trim(), destination);
  assert.equal(json(join(destination, 'src/app.json')).name, basename(destination));
});

test('prints a PowerShell literal-path command for brackets and apostrophes', (t) => {
  const directory = sandbox(t);
  const preload = join(directory, 'windows-output.mjs');
  fs.writeFileSync(preload, "import 'node:path';\nObject.defineProperty(process, 'platform', { value: 'win32' });\n");
  const destination = join(directory, "literal[1]' name");
  const result = run([destination], directory, { imports: [preload] });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`  Set-Location -LiteralPath '${join(directory, "literal[1]'' name")}'\n`));
  assert.doesNotMatch(result.stdout, /\n  cd /);
});

test('excludes local dependency and build artifacts even when they exist in a source template', (t) => {
  const directory = sandbox(t);
  const fixture = join(directory, 'generator');
  fs.mkdirSync(fixture);
  fs.cpSync(join(packageRoot, 'bin'), join(fixture, 'bin'), { recursive: true });
  fs.copyFileSync(join(packageRoot, 'package.json'), join(fixture, 'package.json'));
  fs.cpSync(template, join(fixture, 'template'), { recursive: true });
  for (const artifact of ['node_modules', 'dist', 'build', '.git', 'coverage', '.artifacts']) {
    fs.mkdirSync(join(fixture, 'template', artifact), { recursive: true });
    fs.writeFileSync(join(fixture, 'template', artifact, 'local-only'), 'not starter source');
  }
  for (const lock of ['package-lock.json', 'bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json']) {
    fs.writeFileSync(join(fixture, 'template', lock), 'local-only');
  }
  fs.writeFileSync(join(fixture, 'template', 'tsconfig.tsbuildinfo'), 'local-only');
  const destination = join(directory, 'app');
  const result = run([destination], directory, { executable: join(fixture, 'bin/create-dapp.mjs') });
  assert.equal(result.status, 0, result.stderr);
  for (const artifact of ['node_modules', 'dist', 'build', '.git', 'coverage', '.artifacts', 'tsconfig.tsbuildinfo',
    'package-lock.json', 'bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json']) {
    assert.equal(fs.existsSync(join(destination, artifact)), false, artifact);
  }
});

test('rolls back failed writes while preserving existing directories and unrelated files', (t) => {
  const directory = sandbox(t);
  const preload = join(directory, 'fail-write.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
import { join } from 'node:path';
const write = fs.writeFileSync;
let writes = 0;
fs.writeFileSync = (target, ...args) => {
  if (typeof target === 'number' && ++writes === 2) {
    if (process.env.CREATE_DAPP_TEST_KEEP) write(join(process.env.CREATE_DAPP_TEST_KEEP, 'keep.txt'), 'unrelated');
    throw new Error('simulated write failure');
  }
  return write(target, ...args);
};
`);
  for (const mode of ['new', 'existing', 'unrelated']) {
    const destination = join(directory, mode, 'app');
    if (mode !== 'new') fs.mkdirSync(destination, { recursive: true });
    const result = run([destination], directory, {
      imports: [preload], env: mode === 'unrelated' ? { CREATE_DAPP_TEST_KEEP: destination } : {},
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /simulated write failure/);
    if (mode === 'new') assert.equal(fs.existsSync(join(directory, mode)), false);
    else if (mode === 'existing') assert.deepEqual(fs.readdirSync(destination), []);
    else {
      assert.deepEqual(fs.readdirSync(destination), ['keep.txt']);
      assert.equal(fs.readFileSync(join(destination, 'keep.txt'), 'utf8'), 'unrelated');
    }
  }
});
