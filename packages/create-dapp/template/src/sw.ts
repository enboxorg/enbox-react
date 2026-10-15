/// <reference lib="webworker" />
import { activatePolyfills } from '@enbox/browser';

declare let self: ServiceWorkerGlobalScope;
declare const __APP_SHELL__: { version: string; files: string[] };

// Vite injects only production outputs; development uses its live module server.
if (import.meta.env.PROD) {
  const shell = __APP_SHELL__;
  const prefix = `enbox-shell:${self.registration.scope}:`;
  const cacheName = `${prefix}${shell.version}`;
  const root = new URL(self.registration.scope);
  const index = new URL('index.html', root);
  const files = shell.files.map((file) => new URL(file, self.registration.scope).href);

  self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(cacheName).then((cache) =>
      cache.addAll(files.map((url) => new Request(url, { cache: 'reload' })))));
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith(prefix) && name !== cacheName).map((name) => caches.delete(name)),
    )));
  });
  self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    // This starter has no router: leave other navigation and API routes alone.
    const isIndex = event.request.mode === 'navigate' && url.origin === index.origin &&
      (url.pathname === index.pathname || url.pathname === root.pathname);
    const target = isIndex ? index.href : url.href;
    if (files.includes(target)) {
      event.respondWith(caches.open(cacheName).then(async (cache) =>
        await cache.match(target) ?? fetch(event.request)));
    }
  });
}

// The current browser SDK performs automatic worker takeover.
activatePolyfills({ onCacheCheck: () => ({ ttl: 30_000 }) });
