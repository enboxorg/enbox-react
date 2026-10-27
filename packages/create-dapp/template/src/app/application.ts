import app from '../app.json' with { type: 'json' };
import { TaskBoardStore } from '../features/tasks/store.js';

export const applicationOptions = {
  stores: { tasks: TaskBoardStore },
  wallet: { appName: app.name, applicationId: app.id },
};
