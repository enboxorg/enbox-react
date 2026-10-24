import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:4174/__fixtures__/session.html';

test('connects, reads a public profile, scopes notes and choices to their selected space, and disconnects', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Alice Example' })).toBeVisible();
  await page.getByText('Profile details', { exact: true }).click();
  await expect(page.getByText('did:example:alice', { exact: true }).last()).toBeVisible();
  await page.getByLabel('Space name', { exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.getByLabel('New note', { exact: true }).fill('Ship the example');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Ship the example' }).check();
  await expect(page.getByRole('checkbox', { name: 'Ship the example' })).toBeChecked();
  await page.getByRole('button', { name: 'Choose grow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose grow', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Choose spark', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose spark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Choose grow', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Space name', { exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Ship the example' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose spark', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Ship the example' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Choose spark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Delete note Ship the example', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Ship the example' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/starter-connected.png', fullPage: true });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alice Example' })).toHaveCount(0);
});

test('keeps the app usable without a published profile and allows failed operations to retry', async ({ page }) => {
  await page.goto(`${fixture}?seed&missing-profile&read-error&write-error`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText(/No public profile yet/)).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Fixture read failed.');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'Choose grow', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture save failed.');
  await page.getByRole('button', { name: 'Choose explore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose explore', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('retires pending save presentation when disconnecting', async ({ page }) => {
  await page.goto(`${fixture}?seed&defer-save`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Choose grow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose spark', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.evaluate(() => {
    const controls = window as unknown as { __starterFixture: { finishSave(): void } };
    controls.__starterFixture.finishSave();
  });
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Choose grow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('leaves a declined connection on the connect screen', async ({ page }) => {
  await page.goto(`${fixture}?deny`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('offers wallet repair and blocks writes until reconnected', async ({ page }) => {
  await page.goto(`${fixture}?seed&repair`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText('Reconnect your profile', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose grow', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByText('Reconnect your profile', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose grow', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Choose grow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose grow', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
