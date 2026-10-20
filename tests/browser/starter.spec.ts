import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const appName = process.env.ENBOX_STARTER_APP_NAME ?? 'my-dapp';

test('development entrypoint boots under its app worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.getByRole('heading', { name: appName, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(async () => ({
    scope: (await navigator.serviceWorker.ready).scope,
    controller: navigator.serviceWorker.controller?.scriptURL,
  }))).toEqual({
    scope: 'http://127.0.0.1:4174/',
    controller: 'http://127.0.0.1:4174/src/sw.ts?worker_file&type=module',
  });
  expect(errors).toEqual([]);
});

test('production worker updates its offline shell without deleting other caches', async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const starterDirectory = process.env.ENBOX_STARTER_DIR!;
  const indexPath = join(starterDirectory, 'index.html');
  const originalIndex = readFileSync(indexPath, 'utf8');
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: appName, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveTitle(appName);
    await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
    await page.screenshot({
      path: fileURLToPath(new URL('../../.artifacts/starter-home.png', import.meta.url)),
      fullPage: true,
    });
    const cachePrefix = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      for (const name of ['starter-unrelated', 'drl']) {
        const cache = await caches.open(name);
        await cache.put('/__cache-retention__', new Response(name));
      }
      return `enbox-shell:${registration.scope}:`;
    });
    const previousCaches = await page.evaluate(async (prefix) =>
      (await caches.keys()).filter((name) => name.startsWith(prefix)), cachePrefix);
    expect(previousCaches).toHaveLength(1);

    // Changing only HTML must replace the cached shell even when asset hashes stay the same.
    writeFileSync(indexPath, originalIndex.replace('</head>',
      '<meta name="starter-cache-revision" content="updated" />\n  </head>'));
    execFileSync('npm', ['run', 'build'], { cwd: starterDirectory, stdio: 'inherit' });
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const previousController = navigator.serviceWorker.controller;
      const changed = new Promise<void>((resolve) => {
        const onChange = (): void => {
          if (navigator.serviceWorker.controller === previousController) return;
          navigator.serviceWorker.removeEventListener('controllerchange', onChange);
          resolve();
        };
        navigator.serviceWorker.addEventListener('controllerchange', onChange);
      });
      await registration.update();
      await changed;
    });
    await expect.poll(() => page.evaluate(async (prefix) =>
      (await caches.keys()).filter((name) => name.startsWith(prefix)), cachePrefix)).not.toContain(previousCaches[0]);
    const updatedCaches = await page.evaluate(async (prefix) =>
      (await caches.keys()).filter((name) => name.startsWith(prefix)), cachePrefix);
    expect(updatedCaches).toHaveLength(1);
    expect(updatedCaches[0]).not.toBe(previousCaches[0]);
    expect(await page.evaluate(async () => Promise.all(['starter-unrelated', 'drl'].map(async (name) => {
      const response = await (await caches.open(name)).match('/__cache-retention__');
      return response?.text();
    })))).toEqual(['starter-unrelated', 'drl']);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('meta[name="starter-cache-revision"]')).toHaveAttribute('content', 'updated');
    await expect(page.getByRole('heading', { name: appName, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
    expect(errors).toEqual([]);
  } finally {
    writeFileSync(indexPath, originalIndex);
    await context.setOffline(false);
  }
});
