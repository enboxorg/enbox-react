import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:4174/__fixtures__/session.html';

test('connects, edits and completes tasks, and keeps projects separate', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Alice Example' })).toBeVisible();
  await page.getByText('Profile details', { exact: true }).click();
  await expect(page.getByText('did:example:alice', { exact: true }).last()).toBeVisible();
  await page.getByLabel('Project name', { exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByLabel('New task', { exact: true }).fill('Ship the example');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const details = page.getByRole('region', { name: 'Task details', exact: true });
  await expect(details).toContainText('Ship the example · To do');
  await page.getByRole('button', { name: 'Edit title', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Ship the task board');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.getByLabel('Task title', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Complete Ship the task board', exact: true }).check();
  await expect(details).toContainText('Ship the task board · Completed');

  await page.getByLabel('New task', { exact: true }).fill('Review the protocol');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(details).toContainText('Review the protocol · To do');
  await page.getByRole('button', { name: 'Open task Ship the task board', exact: true }).click();
  await expect(details).toContainText('Ship the task board · Completed');

  await page.getByLabel('Project name', { exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(details).toHaveCount(0);
  await page.getByLabel('New task', { exact: true }).fill('Water the plants');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(details).toContainText('Water the plants · To do');
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Complete Ship the task board', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Complete Water the plants', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open task Ship the task board', exact: true }).click();
  await expect(details).toContainText('Completed');
  await page.getByRole('checkbox', { name: 'Complete Ship the task board', exact: true }).uncheck();
  await expect(details).toContainText('To do');
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Complete Ship the task board', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Complete Review the protocol', exact: true })).toBeVisible();
  await expect(details).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/starter-connected.png', fullPage: true });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alice Example' })).toHaveCount(0);
});

test('retains the selected project when live updates move it outside the visible page', async ({ page }) => {
  await page.goto(`${fixture}?seed`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'First project', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Complete First task', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const controls = window as unknown as { __starterFixture: { addProjects(count: number): void } };
    controls.__starterFixture.addProjects(20);
  });
  await expect(page.getByRole('button', { name: 'First project', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Complete First task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More projects', exact: true }).click();
  await expect(page.getByRole('button', { name: 'First project', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: 'Complete First task', exact: true })).toBeVisible();
});

test('keeps the app usable without a published profile and allows failed operations to retry', async ({ page }) => {
  await page.goto(`${fixture}?seed&missing-profile&read-error&write-error`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText(/No public profile yet/)).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Fixture read failed.');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'First project', exact: true }).click();
  await page.getByLabel('New task', { exact: true }).fill('Retry this task');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture save failed.');
  await expect(page.getByLabel('New task', { exact: true })).toHaveValue('Retry this task');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Complete Retry this task', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('distinguishes a failed task lookup from a confirmed missing task', async ({ page }) => {
  await page.goto(`${fixture}?seed&detail-read-error`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'First project', exact: true }).click();
  await page.getByRole('button', { name: 'Open task First task', exact: true }).click();
  const details = page.getByRole('region', { name: 'Task details', exact: true });
  await expect(details.getByRole('alert')).toContainText('Couldn’t load the task.');
  await expect(details.getByText('This task is no longer available.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry task', exact: true }).click();
  await expect(details).toContainText('First task · To do');
  await expect(details.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    const controls = window as unknown as { __starterFixture: { removeTasks(): void } };
    controls.__starterFixture.removeTasks();
  });
  await expect(details.getByText('This task is no longer available.', { exact: true })).toBeVisible();
  await expect(details.getByRole('alert')).toHaveCount(0);
});

test('retires pending completion presentation when disconnecting', async ({ page }) => {
  await page.goto(`${fixture}?seed&defer-save`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'First project', exact: true }).click();
  const completion = page.getByRole('checkbox', { name: 'Complete First task', exact: true });
  await completion.click();
  await expect(completion).toBeDisabled();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.evaluate(() => {
    const controls = window as unknown as { __starterFixture: { finishSave(): void } };
    controls.__starterFixture.finishSave();
  });
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeEnabled();
  await expect(completion).toHaveCount(0);
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
  const completion = page.getByRole('checkbox', { name: 'Complete First task', exact: true });
  await expect(page.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByText('Reconnect your profile', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'First project', exact: true }).click();
  await expect(completion).toBeEnabled();
  await completion.check();
  await expect(completion).toBeChecked();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
