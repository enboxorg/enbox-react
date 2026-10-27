import { DateSort, defineStore } from '@enbox/browser';

import { TaskBoardProtocol } from './protocol.js';

/** Protocol resources and domain defaults are shared with every consumer. */
export const TaskBoardStore = defineStore({
  protocols: { board: TaskBoardProtocol },
  create({ protocols, resource, command }) {
    const projects = protocols.board.collection('project', { dateSort: DateSort.CreatedDescending });
    const tasks = protocols.board.collection('project/task');
    const activeTasks = resource({ selection: null, source: (parent: string) => tasks.within(parent) });
    const taskById = (within: string, recordId: string) => protocols.board.collection('project/task', {
      filter: { recordId }, pagination: { limit: 1 },
    }).within(within);

    return {
      projects,
      tasks,
      activeTasks,
      taskById,
      createProject: command((name: string) => projects.create.run({ name: name.trim() })),
      createTask: ({ within, title }: { within: string; title: string }) =>
        tasks.within(within).create.run({ title: title.trim(), completed: false }),
      renameTask: ({ within, id, title }: { within: string; id: string; title: string }) =>
        tasks.within(within).patch.run({ id, patch: { title: title.trim() } }),
    };
  },
});
