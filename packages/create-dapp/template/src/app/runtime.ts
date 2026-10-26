import { BrowserConnectHandler, createApplication, createConnectionStore } from '@enbox/browser';

import { application, wallet } from './application.js';

let runtime: ReturnType<typeof createApplication> | undefined;

/** One browser-lifetime owner shared by React and application controllers. */
export function getApplication() {
  return runtime ??= createApplication(application, {
    connection: createConnectionStore({
      application: application.manifest,
      connectHandler: BrowserConnectHandler(wallet),
    }),
  });
}

if (import.meta.hot) import.meta.hot.dispose(() => { void runtime?.dispose(); });
