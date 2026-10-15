import { activatePolyfills } from '@enbox/browser';
import { EnboxProvider } from '@enbox/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { config } from './application.js';
import './style.css';

/** Wait for this app's worker to control the page before initializing Enbox. */
async function prepareBrowser(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('This browser needs service worker support.');
  const workerPath = `${import.meta.env.BASE_URL}${import.meta.env.DEV ? 'dev-sw.js?dev-sw' : 'sw.js'}`;
  const workerUrl = new URL(workerPath, window.location.href).href;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let stopListening = (): void => {};
  try {
    await Promise.race([
      (async () => {
        await navigator.serviceWorker.register(workerUrl, { type: 'module' });
        if (finished) throw new Error('Service worker startup wait ended.');
        await navigator.serviceWorker.ready;
        if (finished) throw new Error('Service worker startup wait ended.');
        // A ready registration does not guarantee that our worker controls this page.
        await new Promise<void>((resolve) => {
          const resolveWhenControlled = (): void => {
            if (navigator.serviceWorker.controller?.scriptURL === workerUrl) resolve();
          };
          navigator.serviceWorker.addEventListener('controllerchange', resolveWhenControlled);
          stopListening = () => navigator.serviceWorker.removeEventListener('controllerchange', resolveWhenControlled);
          resolveWhenControlled();
        });
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The app service worker did not become ready. Reload to try again.')), 20_000);
      }),
    ]);
    activatePolyfills({ serviceWorker: false });
  } finally {
    finished = true;
    clearTimeout(timer);
    stopListening();
  }
}

void prepareBrowser().then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><EnboxProvider config={config}><App /></EnboxProvider></StrictMode>);
}).catch((cause: unknown) => {
  const root = document.getElementById('root')!;
  root.textContent = cause instanceof Error ? cause.message : 'Could not open the app.';
});
