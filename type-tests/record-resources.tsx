import { EnboxRecordsProvider, useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { createRecordStore, defineProtocol, defineRecordStore, recordCodecs } from '@enbox/react/config';
import type { ConnectionStore, TypedRecord } from '@enbox/browser';

const protocol = defineProtocol({
  protocol: 'https://example.test/record-resources', published: false,
  types: { project: { dataFormats: ['application/json'] }, task: { dataFormats: ['application/json'] }, settings: { dataFormats: ['application/json'] }, member: { dataFormats: ['application/json'] } },
  structure: { settings: { $recordLimit: { max: 1 } }, project: { task: {}, settings: { $recordLimit: { max: 1 } }, member: { $role: true } } },
} as const, {
  project: recordCodecs.json<{ name: string }>(), task: recordCodecs.json<{ title: string; done: boolean }>(),
  settings: recordCodecs.json<{ theme: string }>(), member: recordCodecs.json<{}>(),
});
const projects = defineRecordStore({ protocol, path: 'project' });
const tasks = defineRecordStore({ protocol, path: 'project/task', options: null });
const task = defineRecordStore({ protocol, path: 'project/task', kind: 'record', options: null });
const settings = defineRecordStore({ protocol, path: 'settings', kind: 'singleton' });
declare const client: ConnectionStore;

export function HeadlessContracts(): void {
  const store = createRecordStore(tasks, { client });
  const path: 'project/task' = store.definition.path;
  void path;
  createRecordStore(tasks, { client, selection: { within: 'project' } });
  // @ts-expect-error initial selection overrides obey the same parent contract
  createRecordStore(tasks, { client, selection: {} });
  store.select({ within: 'project' });
  const created: Promise<TypedRecord<{ title: string; done: boolean }>> = store.commands.create({ title: 'First', done: false });
  void created;
  store.commands.patch({ id: 'task', patch: (current) => ({ done: !current.done }) });
  const title: string | undefined = store.getSnapshot().records[0]?.data.title;
  const within: string | undefined = store.getSnapshot().selection?.within;
  void [title, within];
  // @ts-expect-error nested collection selections require their parent
  store.select({});
  // @ts-expect-error writes retain the resource codec
  store.commands.create({ name: 'Wrong' });
  // @ts-expect-error materialized snapshots are read-only
  store.getSnapshot().records[0]!.data.title = 'Wrong';
  createRecordStore(settings, { client }).commands.set({ theme: 'dark' });
  const single = createRecordStore(task, { client });
  single.select({ within: 'project', recordId: 'task' });
  // @ts-expect-error an ID selection has no singleton set command
  single.commands.set({ title: 'Wrong' });
  // @ts-expect-error an ID selection must name its record
  single.select({ within: 'project' });
}

export function ReactContracts(): React.JSX.Element {
  const rows = useEnboxRecords(tasks);
  rows.create.mutate({ title: 'First', done: false });
  rows.select({ within: 'project' });
  const text: string | undefined = rows.records[0]?.data.title;
  const source: string | undefined = rows.selection?.within;
  const owner = rows.store;
  const sameShape: Promise<TypedRecord<{ title: string; done: boolean }>> = owner.commands.create({ title: 'Headless', done: true });
  void [text, source, sameShape];
  const one = useEnboxRecord(task);
  one.patch.mutate({ done: true });
  const theme: string | undefined = useEnboxRecord(settings).data?.theme;
  void theme;
  // @ts-expect-error React bindings keep the codec contract
  rows.patch.mutate({ id: 'task', patch: { done: 'yes' } });
  // @ts-expect-error record bindings are not collections
  useEnboxRecords(task);
  // @ts-expect-error collection bindings are not single records
  useEnboxRecord(tasks);
  return <EnboxRecordsProvider records={{ projects, tasks, task, settings }}><span /></EnboxRecordsProvider>;
}

// @ts-expect-error ordinary paths cannot be declared singletons
defineRecordStore({ protocol, path: 'project/task', kind: 'singleton', options: { within: 'project' } });
// @ts-expect-error nested collections need a parent or null to start disabled
defineRecordStore({ protocol, path: 'project/task' });
// @ts-expect-error root records cannot take a parent
defineRecordStore({ protocol, path: 'project', options: { within: 'parent' } });
// @ts-expect-error role records use the native membership surface
defineRecordStore({ protocol, path: 'project/member', options: { within: 'project' } });
// @ts-expect-error remote reads are outside local CRUD definitions
defineRecordStore({ protocol, path: 'project', options: { from: 'did:example:other' } });
