import { createHash } from 'node:crypto';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'app-shell',
      apply: 'build',
      generateBundle: {
        // Wait for Vite to emit the worker and finalize index.html.
        order: 'post',
        handler(_options, bundle) {
          const worker = bundle['sw.js'];
          if (worker?.type !== 'asset' || typeof worker.source !== 'string') {
            this.error('The app service worker was not emitted.');
          }
          const files = Object.keys(bundle).filter((file) => !file.endsWith('.map')).sort();
          const hash = createHash('sha256');
          for (const file of files) {
            const output = bundle[file]!;
            hash.update(file).update('\0').update(output.type === 'chunk' ? output.code : output.source);
          }
          worker.source = worker.source.replace('__APP_SHELL__', JSON.stringify({
            version: hash.digest('hex').slice(0, 16),
            files: files.filter((file) => file !== 'sw.js'),
          }));
        },
      },
    },
  ],
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'sw.js' } } },
  server: { host: '127.0.0.1', headers: { 'Service-Worker-Allowed': '/' } },
  preview: { host: '127.0.0.1' },
});
