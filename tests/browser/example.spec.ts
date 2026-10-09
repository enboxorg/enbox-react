import { expect, test } from '@playwright/test';

test('production example boots with a controlling worker and its shell reloads offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
