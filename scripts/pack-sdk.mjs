import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function normalizePackageFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) normalizePackageFiles(path);
    else if (entry.isFile()) chmodSync(path, 0o644);
  }
}

/** Pack one publish candidate and an identical, immutable consumer archive. */
export function packSdk(root) {
  const artifacts = join(root, '.artifacts');
  const archivePath = join(artifacts, 'enbox-react.tgz');
  mkdirSync(artifacts, { recursive: true });
  // Match clean checkouts even when a developer uses a different file umask.
  for (const directory of ['src', 'dist']) normalizePackageFiles(join(root, directory));
  for (const file of ['package.json', 'README.md', 'LICENSE']) chmodSync(join(root, file), 0o644);
  execFileSync('bun', ['pm', 'pack', '--ignore-scripts', '--filename', archivePath, '--quiet'], {
    cwd: root, stdio: 'inherit',
  });
  const packed = readFileSync(archivePath);
  const archiveName = 'enbox-react-' + createHash('sha256').update(packed).digest('hex') + '.tgz';
  const immutableArchivePath = join(artifacts, archiveName);
  // Package managers must not reuse a previous local archive of this version.
  cpSync(archivePath, immutableArchivePath);
  return {
    archivePath,
    archiveName,
    immutableArchivePath,
    integrity: 'sha512-' + createHash('sha512').update(packed).digest('base64'),
  };
}
