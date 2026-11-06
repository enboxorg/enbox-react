import { DateSort, defineStore } from '@enbox/browser';

import { TaskBoardModule } from './module.js';

/** Module observations and domain defaults are shared with every consumer. */
export const TaskBoardStore = defineStore({
  modules: { board: TaskBoardModule },
  create({ modules, observe }) {
    const projects = modules.board.collection('project', { dateSort: DateSort.CreatedDescending });
    const tasks = modules.board.collection('project/task');
    const activeTasks = observe({ source: (parent: string) => tasks.within(parent) });
    const taskById = (within: string, recordId: string) => modules.board.collection('project/task', {
      filter: { recordId }, pagination: { limit: 1 },
    }).within(within);

    return {
      projects,
      tasks,
      activeTasks,
      taskById,
      createProject: (name: string) => projects.create.run({ name: name.trim() }),
      createTask: ({ within, title }: { within: string; title: string }) =>
        tasks.within(within).create.run({ title: title.trim(), completed: false }),
      renameTask: ({ within, id, title }: { within: string; id: string; title: string }) =>
        tasks.within(within).patch.run({ id, patch: { title: title.trim() } }),
    };
  },
});
