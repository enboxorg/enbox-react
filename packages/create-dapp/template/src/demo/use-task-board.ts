import { useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { DateSort } from '@enbox/react/config';

import { TaskBoardProtocol } from './protocol.js';

export function useProjects() {
  return useEnboxRecords(TaskBoardProtocol, 'project', { pagination: { limit: 20 }, dateSort: DateSort.CreatedDescending });
}

export function useTasks(within: string) {
  return useEnboxRecords(TaskBoardProtocol, 'project/task', { within, pagination: { limit: 20 } });
}

export function useTask(within: string, recordId: string) {
  return useEnboxRecord(TaskBoardProtocol, 'project/task', { within, recordId });
}
