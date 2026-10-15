import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const consumers = ['tests/compatibility/react18/package.json', 'tests/compatibility/starter/package.json'];
const manifests = [
  'package.json',
  'packages/create-dapp/package.json',
  'packages/create-dapp/template/package.json',
  ...consumers,
];
const exactVersion = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;

for (const path of manifests) {
  test(`${path} keeps direct dependencies pinned`, () => {
    const manifest = JSON.parse(readFileSync(new URL(path, root), 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        const localSdk = consumers.includes(path)
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

test('SDK consumers select supported peer releases', () => {
  const sdk = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  for (const path of consumers) {
    const consumer = JSON.parse(readFileSync(new URL(path, root), 'utf8'));
    for (const [name, releases] of Object.entries(sdk.peerDependencies ?? {})) {
      const selected = consumer.dependencies?.[name] ?? consumer.devDependencies?.[name] ?? consumer.optionalDependencies?.[name];
      if (selected === undefined && sdk.peerDependenciesMeta?.[name]?.optional === true) continue;
      assert.ok(releases.split('||').map((release) => release.trim()).includes(selected),
        `${path}: ${name}@${selected ?? 'missing'} must select one of the SDK's tested releases (${releases}).`);
    }
  }
});
