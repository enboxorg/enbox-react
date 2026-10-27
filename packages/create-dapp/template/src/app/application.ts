import { defineApplication } from '@enbox/browser';

import app from '../app.json' with { type: 'json' };
import { TaskBoardStore } from '../features/tasks/store.js';

export const applicationDefinition = defineApplication({ stores: { tasks: TaskBoardStore } });
export const wallet = { appName: app.name, applicationId: app.id };
