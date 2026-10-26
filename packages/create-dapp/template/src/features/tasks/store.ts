import { DateSort, defineStore } from '@enbox/browser';

import { TaskBoardProtocol } from './protocol.js';

/** Protocol resources and domain defaults are shared with every consumer. */
export const TaskBoardStore = defineStore({
  protocols: { board: TaskBoardProtocol },
  create({ protocols, command }) {
    const projects = protocols.board.collection('project', { dateSort: DateSort.CreatedDescending });
    const tasks = protocols.board.collection('project/task');

    return {
      projects,
      tasks,
      createProject: command((name: string) => projects.create.run({ name: name.trim() })),
      createTask: ({ within, title }: { within: string; title: string }) =>
        tasks.within(within).create.run({ title: title.trim(), completed: false }),
      renameTask: ({ within, id, title }: { within: string; id: string; title: string }) =>
        tasks.within(within).patch.run({ id, patch: { title: title.trim() } }),
      moreProjects: command<void, void>(() => projects.loadMore()),
      moreTasks: command((within: string) => tasks.within(within).loadMore()),
      retryProjects: command<void, void>(() => projects.retry()),
      retryTasks: command((within: string) => tasks.within(within).retry()),
    };
  },
});
