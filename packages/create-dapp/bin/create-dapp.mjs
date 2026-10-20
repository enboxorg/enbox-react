#!/usr/bin/env node

import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const excluded = new Set([
  'node_modules', 'dist', 'build', '.git', '.artifacts', '.vite', '.cache',
  'coverage', 'test-results', 'playwright-report', '.DS_Store',
]);

const usage = `Create a minimal Enbox React application.

Usage:
  npm create @enbox/dapp@latest [directory]
  npx @enbox/create-dapp@latest [directory]

Options:
  -h, --help     Show this help
  -v, --version  Show the generator version

The destination must be empty. No dependencies are installed and no Git
repository is created. Use "." to create an app in the current empty directory.
`;

function assertEmptyDestination(destination) {
  const stat = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (stat === undefined) return;
  if (stat.isSymbolicLink()) throw new Error('The destination must not be a symbolic link.');
  if (!stat.isDirectory()) throw new Error('The destination must be a directory.');
  if (fs.readdirSync(destination).length !== 0) throw new Error('The destination directory is not empty.');
}

function readTemplate(directory, prefix = '', files = new Map()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.endsWith('.tsbuildinfo')) continue;
    const source = join(directory, entry.name);
    const name = prefix === '' && entry.name === '_gitignore' ? '.gitignore' : entry.name;
    const relative = join(prefix, name);
    if (entry.isDirectory()) readTemplate(source, relative, files);
    else if (entry.isFile()) {
      if (files.has(relative)) throw new Error(`Duplicate template file: ${relative}`);
      files.set(relative, fs.readFileSync(source));
    } else throw new Error(`Unsupported template entry: ${relative}`);
  }
  return files;
}

function customizeJson(files, path, update) {
  try {
    const contents = files.get(path);
    if (contents === undefined) throw new Error('file is missing');
    const value = JSON.parse(contents.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a JSON object');
    update(value);
    files.set(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
  } catch (cause) {
    throw new Error(`Invalid starter template ${path}: ${cause.message}`, { cause });
  }
}

function packageName(name) {
  return name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 214).replace(/-+$/g, '') || 'enbox-dapp';
}

function createProject(destination) {
  assertEmptyDestination(destination);
  const files = readTemplate(join(packageRoot, 'template'));
  const displayName = basename(destination);
  const name = packageName(displayName);
  customizeJson(files, 'package.json', (value) => { value.name = name; });
  customizeJson(files, join('src', 'app.json'), (value) => {
    value.id = name;
    value.name = displayName;
  });
  customizeJson(files, 'package-lock.json', (value) => {
    if (value.packages?.[''] === undefined) throw new Error('root package metadata is missing');
    value.name = name;
    value.packages[''].name = name;
  });

  const createdFiles = [];
  const createdDirectories = [];
  const ensureDirectory = (directory) => {
    try {
      fs.mkdirSync(directory);
      createdDirectories.push(directory);
    } catch (cause) {
      if (cause.code === 'ENOENT') {
        ensureDirectory(dirname(directory));
        ensureDirectory(directory);
      } else if (cause.code !== 'EEXIST' || !fs.lstatSync(directory).isDirectory()) throw cause;
    }
  };
  try {
    ensureDirectory(destination);
    assertEmptyDestination(destination);
    for (const [relative, contents] of files) {
      const target = join(destination, relative);
      ensureDirectory(dirname(target));
      const descriptor = fs.openSync(target, 'wx');
      createdFiles.push(target);
      try { fs.writeFileSync(descriptor, contents); }
      finally { fs.closeSync(descriptor); }
    }
  } catch (cause) {
    // Remove only entries created by this invocation; keep preexisting directories.
    for (const file of createdFiles.reverse()) {
      try { fs.unlinkSync(file); } catch {}
    }
    for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch {}
    }
    throw new Error(`Could not create the app: ${cause.message}`, { cause });
  }
}

function quoteDirectory(directory) {
  return process.platform === 'win32'
    ? `'${directory.replaceAll("'", "''")}'`
    : `'${directory.replaceAll("'", "'\\''")}'`;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
    allowPositionals: true,
  });
  if (values.help) { console.log(usage); return; }
  if (values.version) { console.log(manifest.version); return; }
  if (positionals.length > 1) throw new Error('Provide one target directory. Run with --help for usage.');
  let directory = positionals[0];
  if (directory === undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Provide a target directory. Run with --help for usage.');
    }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { directory = await prompt.question('Project directory: '); }
    finally { prompt.close(); }
  }
  if (directory.trim() === '' || /[\u0000-\u001f\u007f]/.test(directory)) {
    throw new Error('Provide a nonempty target directory without control characters.');
  }
  const destination = resolve(directory);
  createProject(destination);
  const changeDirectory = process.platform === 'win32' ? 'Set-Location -LiteralPath' : 'cd';
  console.log(`Created ${basename(destination)}.\n\n${process.platform === 'win32' ? 'In PowerShell' : 'Next'}:\n  ${changeDirectory} ${quoteDirectory(destination)}\n  npm ci\n  npm run dev`);
}

main().catch((cause) => {
  console.error(`create-dapp: ${cause.message}`);
  process.exitCode = 1;
});
