import { useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { projects, selectedTask, tasks } from './records.js';

export function useProjects() {
  return useEnboxRecords(projects);
}

export function useTasks() {
  return useEnboxRecords(tasks);
}

export function useTask() {
  return useEnboxRecord(selectedTask);
}
