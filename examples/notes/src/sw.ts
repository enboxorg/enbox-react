/// <reference lib="webworker" />
import { activatePolyfills } from '@enbox/browser';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { PrecacheEntry } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
// The current browser SDK performs automatic worker takeover.
activatePolyfills({ onCacheCheck: () => ({ ttl: 30_000 }) });
