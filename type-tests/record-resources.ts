import { useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { createRecordStore, createRecordsStore, defineProtocol, recordCodecs } from '@enbox/react/config';
import type { ConnectionStore, TypedRecord } from '@enbox/browser';

const protocol = defineProtocol({
  protocol: 'https://example.test/record-resources', published: false,
  types: { project: { dataFormats: ['application/json'] }, task: { dataFormats: ['application/json'] }, settings: { dataFormats: ['application/json'] }, member: { dataFormats: ['application/json'] } },
  structure: { settings: { $recordLimit: { max: 1 } }, project: { task: {}, settings: { $recordLimit: { max: 1 } }, member: { $role: true } } },
} as const, {
  project: recordCodecs.json<{ name: string }>(), task: recordCodecs.json<{ title: string; done: boolean }>(),
  settings: recordCodecs.json<{ theme: string }>(), member: recordCodecs.json<{}>(),
});
declare const client: ConnectionStore;

export function HeadlessContracts(): void {
  const store = createRecordsStore({ client, protocol, path: 'project/task', options: { within: 'project' } });
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
  createRecordStore({ client, protocol, path: 'settings' }).commands.set({ theme: 'dark' });
  const single = createRecordStore({ client, protocol, path: 'project/task', options: { within: 'project', recordId: 'task' } });
  single.commands.patch({ done: true });
  // @ts-expect-error an ID selection has no singleton set command
  single.commands.set({ title: 'Wrong' });
  // @ts-expect-error an ID selection must name its record
  single.select({ within: 'project' });
}

export function ReactContracts(): void {
  const rows = useEnboxRecords(protocol, 'project/task', { within: 'project' });
  rows.create.mutate({ title: 'First', done: false });
  const text: string | undefined = rows.records[0]?.data.title;
  void text;
  const one = useEnboxRecord(protocol, 'project/task', { within: 'project', recordId: 'task' });
  one.patch.mutate({ done: true });
  const theme: string | undefined = useEnboxRecord(protocol, 'settings').data?.theme;
  void theme;
  const owner = createRecordsStore({ client, protocol, path: 'project/task', options: null });
  const borrowed = useEnboxRecords(owner);
  borrowed.store.select({ within: 'project' });
  const source: string | undefined = borrowed.selection?.within;
  void source;
  useEnboxRecord(createRecordStore({ client, protocol, path: 'settings' })).set.mutate({ theme: 'light' });
  const detail = useEnboxRecord(createRecordStore({ client, protocol, path: 'project/task', options: null }));
  const title: string | undefined = detail.data?.title;
  void title;
  // @ts-expect-error React bindings keep the codec contract
  rows.patch.mutate({ id: 'task', patch: { done: 'yes' } });
  // @ts-expect-error record owners are not collections
  useEnboxRecords(createRecordStore({ client, protocol, path: 'settings' }));
  // @ts-expect-error collection owners are not single records
  useEnboxRecord(owner);
}

// @ts-expect-error nested collections need a parent or null to start disabled
createRecordsStore({ client, protocol, path: 'project/task' });
// @ts-expect-error a non-singleton path needs a record ID
createRecordStore({ client, protocol, path: 'project/task', options: { within: 'project' } });
// @ts-expect-error root records cannot take a parent
createRecordsStore({ client, protocol, path: 'project', options: { within: 'parent' } });
// @ts-expect-error role records use the native membership surface
createRecordsStore({ client, protocol, path: 'project/member', options: { within: 'project' } });
// @ts-expect-error remote reads are outside local CRUD stores
createRecordsStore({ client, protocol, path: 'project', options: { from: 'did:example:other' } });
