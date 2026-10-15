import { defineConfig } from '@playwright/test';

const starterDirectory = process.env.ENBOX_STARTER_DIR;
if (!starterDirectory) throw new Error('Run bun run test:browser to verify a freshly generated starter.');

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, viewport: { width: 1280, height: 900 } },
  webServer: [
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      cwd: starterDirectory,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
      cwd: starterDirectory,
      url: 'http://127.0.0.1:4174/__fixtures__/session.html',
      reuseExistingServer: false,
    },
  ],
});
