import { createApplication } from '@enbox/browser';

import { applicationOptions } from './application.js';

let runtime: ReturnType<typeof createApplication> | undefined;

/** One browser-lifetime owner shared by React and application controllers. */
export function getApplication() {
  return runtime ??= createApplication(applicationOptions);
}

if (import.meta.hot) import.meta.hot.dispose(() => { void runtime?.dispose(); });
