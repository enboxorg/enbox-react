import { DateSort, defineRecordStore } from '@enbox/react/config';

import { TaskBoardProtocol } from './protocol.js';

export const projects = defineRecordStore({
  protocol: TaskBoardProtocol, path: 'project', options: { dateSort: DateSort.CreatedDescending },
});
export const tasks = defineRecordStore({ protocol: TaskBoardProtocol, path: 'project/task', options: null });
export const selectedTask = defineRecordStore({ protocol: TaskBoardProtocol, path: 'project/task', kind: 'record', options: null });

// One definition per resource. Controllers can use these with createRecordStore too.
export const taskBoardRecords = { projects, tasks, selectedTask };
