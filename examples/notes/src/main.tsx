import { activatePolyfills } from '@enbox/browser';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './style.css';

async function prepareBrowser(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('This browser needs service worker support.');
  const workerPath = `${import.meta.env.BASE_URL}${import.meta.env.DEV ? 'dev-sw.js?dev-sw' : 'sw.js'}`;
  const workerUrl = new URL(workerPath, window.location.href).href;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  let stopListening = (): void => {};
  try {
    await Promise.race([
      (async () => {
        await navigator.serviceWorker.register(workerUrl, { type: 'module' });
        if (ended) throw new Error('Service worker startup wait ended.');
        await navigator.serviceWorker.ready;
        if (ended) throw new Error('Service worker startup wait ended.');
        await new Promise<void>((resolve) => {
          const check = (): void => {
            if (navigator.serviceWorker.controller?.scriptURL === workerUrl) resolve();
          };
          navigator.serviceWorker.addEventListener('controllerchange', check);
          stopListening = () => navigator.serviceWorker.removeEventListener('controllerchange', check);
          check();
        });
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The notes service worker did not become ready. Reload to try again.')), 20_000);
      }),
    ]);
    activatePolyfills({ serviceWorker: false });
  } finally {
    ended = true;
    clearTimeout(timer);
    stopListening();
  }
}

void prepareBrowser().then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}).catch((cause: unknown) => {
  const root = document.getElementById('root')!;
  root.textContent = cause instanceof Error ? cause.message : 'Could not open notes.';
});
