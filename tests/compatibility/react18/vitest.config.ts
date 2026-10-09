import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['generated/tests/setup.ts'],
    include: ['generated/tests/*.spec.{ts,tsx}'],
    execArgv: Number(process.versions.node.split('.')[0]) >= 25 ? ['--no-webstorage'] : [],
  },
});
