import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const manifests = [
  'package.json',
  'packages/create-dapp/package.json',
  'packages/create-dapp/template/package.json',
  'tests/compatibility/react18/package.json',
];
const exactVersion = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;

for (const path of manifests) {
  test(`${path} keeps direct dependencies pinned`, () => {
    const manifest = JSON.parse(readFileSync(new URL(path, root), 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        const localSdk = path === 'tests/compatibility/react18/package.json'
          && section === 'dependencies' && name === '@enbox/react'
          && version === 'file:../../../.artifacts/enbox-react.tgz';
        assert.ok(localSdk || exactVersion.test(version),
          `${path}: ${section}.${name} must use an exact version (${version}).`);
      }
    }
    for (const [name, versions] of Object.entries(manifest.peerDependencies ?? {})) {
      assert.ok(versions.split('||').every((version) => exactVersion.test(version.trim())),
        `${path}: peerDependencies.${name} must list exact tested releases (${versions}).`);
    }
  });
}
