import type { ConnectionStore } from '@enbox/browser';
import { useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { createRecordStore, defineProtocol, recordCodecs } from '@enbox/react/config';

const protocol = defineProtocol({
  protocol: 'https://example.test/shared-records', published: false,
  types: { project: { dataFormats: ['application/json'] }, page: { dataFormats: ['application/json'] }, settings: { dataFormats: ['application/json'] } },
  structure: { project: { page: {} }, settings: { $recordLimit: { max: 1 } } },
} as const, { project: recordCodecs.json<{ name: string }>(), page: recordCodecs.json<{ title: string }>(), settings: recordCodecs.json<{ theme: string }>() });
declare const client: ConnectionStore;
const pages = createRecordStore({ client, protocol, path: 'project/page', options: null });
const settings = createRecordStore({ client, protocol, path: 'settings' });

export async function Controller(): Promise<void> {
  pages.select({ within: 'project' });
  const created = await pages.commands.create({ title: 'Page' });
  const title: string = created.data.title;
  void title;
  await pages.commands.create({ title: 'Other project' }, { within: 'other' });
  await pages.commands.patch({ id: created.id, patch: (current) => ({ title: `${current.title}!` }) });
  await pages.commands.delete(created.id, { prune: true });
  await settings.commands.set({ theme: 'dark' });
  await settings.commands.patch({ patch: { theme: 'light' } });
  await settings.commands.delete();
  const all = await pages.query({ within: 'project' });
  const context: string | undefined = all[0]?.contextId;
  void context;
  // @ts-expect-error a child query requires its parent
  pages.select({});
  // @ts-expect-error an ordinary record mutation requires an ID
  pages.commands.patch({ patch: { title: 'Missing ID' } });
  // @ts-expect-error ordinary paths have no singleton upsert
  pages.commands.set({ title: 'No' });
  // @ts-expect-error payloads follow the protocol codec
  pages.commands.create({ name: 'Wrong' });
}

export function ReactConsumer(): void {
  const list = useEnboxRecords(pages);
  const title: string | undefined = list.records[0]?.data.title;
  void title;
  useEnboxRecords(Math.random() > 0.5 ? pages : null).create.mutate({ title: 'Page' });
  useEnboxRecord(settings).set.mutate({ theme: 'dark' });
  // @ts-expect-error read results are immutable
  list.records[0]!.data.title = 'No';
}

// @ts-expect-error nested paths need options, including null while no parent is selected
createRecordStore({ client, protocol, path: 'project/page' });
// @ts-expect-error root paths do not accept a parent scope
createRecordStore({ client, protocol, path: 'project', options: { within: 'other' } });
