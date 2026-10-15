import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('packed starter boots with a controlling worker and reloads its shell offline', async ({ page, context }) => {
  const errors: string[] = [];
  const appName = process.env.ENBOX_STARTER_APP_NAME ?? 'my-dapp';
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: appName, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(appName);
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  await page.screenshot({
    path: fileURLToPath(new URL('../../.artifacts/starter-home.png', import.meta.url)),
    fullPage: true,
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: appName, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  expect(errors).toEqual([]);
});
