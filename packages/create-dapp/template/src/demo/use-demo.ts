import { useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { DateSort } from '@enbox/react/config';

import { DemoProtocol } from './protocol.js';

export function useProjects() {
  return useEnboxRecords(DemoProtocol, 'project', { pagination: { limit: 20 }, dateSort: DateSort.CreatedDescending });
}

export function useTasks(within: string) {
  return useEnboxRecords(DemoProtocol, 'project/task', { within, pagination: { limit: 20 } });
}

export function useTask(within: string, recordId: string) {
  return useEnboxRecord(DemoProtocol, 'project/task', { within, recordId });
}
