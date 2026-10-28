import { createApplication, type BrowserApplicationOptions } from '@enbox/browser';

import app from '../app.json' with { type: 'json' };
import { TaskBoardStore } from '../features/tasks/store.js';

export const applicationOptions = {
  stores: { tasks: TaskBoardStore },
  wallet: { appName: app.name, applicationId: app.id },
} satisfies BrowserApplicationOptions;

let application: ReturnType<typeof createApplication> | undefined;

/** One application owner for this page, shared by React and application controllers. */
export function getApplication() {
  return application ??= createApplication(applicationOptions);
}
