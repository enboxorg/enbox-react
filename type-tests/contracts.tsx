import type { TypedMaterializedRecord, TypedRecord } from '@enbox/browser';
import type { RecordsOptions, RecordsResult } from '@enbox/react';

import { EnboxProvider, useContextView, useEnboxConnection, useEnboxMutation, useProfile, useProfiles, useProtocol, useRecords } from '@enbox/react';
import { createContextStore, createEnboxClient, createRecordStore, defineApplicationManifest, defineProtocol, recordCodecs } from '@enbox/react/config';

type Note = { title: string };
type Folder = { name: string };
const protocol = defineProtocol({
  protocol: 'https://example.test/notes', published: false,
  types: { folder: { dataFormats: ['application/json'] }, note: { dataFormats: ['application/json'] } },
  structure: {
    folder: {
      note: { $tags: { category: { type: 'string', enum: ['work', 'home'] } } },
    },
  },
} as const, { folder: recordCodecs.json<Folder>(), note: recordCodecs.json<Note>() });
const application = defineApplicationManifest({ protocols: [protocol] });
const client = createEnboxClient({ application, wallet: { appName: 'Notes' } });
const shared = createRecordStore(async (signal) => client.getSnapshot().enbox!
  .using(protocol).records.observe('folder/note', {
    within: 'parent', materialize: true, pagination: { limit: 10 }, signal,
  }));

export function Contract(): React.ReactNode {
  const bound = useProtocol(protocol);
  const connection = useEnboxConnection();
  const profileName: string | undefined = useProfile(connection.enbox, connection.did).displayName;
  const profile = useProfile(connection.enbox, connection.did, { images: 'lazy' });
  const status: 'idle' | 'loading' | 'settled' | 'not-found' | 'error' = profile.status;
  const imageRequest: Promise<void> = profile.loadImages();
  const profiles = useProfiles(connection.enbox, [connection.did ?? ''], { images: 'off' });
  const profileFailure: string | undefined = profiles.get(connection.did ?? '')?.fields.profile.failure?.message;
  void status;
  void imageRequest;
  void profileFailure;
  // @ts-expect-error image policy is restricted to the supported modes
  useProfile(connection.enbox, connection.did, { images: 'all' });
  void profileName;
  void connection.disconnect({ skipBeforeDisconnect: true });
  // @ts-expect-error per-call wallet and handler configuration are mutually exclusive
  void connection.connect({ wallet: {}, connectHandler: { requestAccess: async () => undefined } });
  const sharedRows = useRecords(shared);
  const sharedTitle: string | undefined = sharedRows.records[0]?.value.title;
  void sharedTitle;
  // @ts-expect-error shared stores preserve decoded record types
  sharedRows.records[0]?.value.name;
  const handles = useRecords(protocol, 'folder/note', { within: 'parent', pagination: { limit: 10 } });
  const handle: TypedRecord<Note> | undefined = handles.records[0];
  const values = useRecords(protocol, 'folder/note', {
    within: 'parent', pagination: { limit: 10 }, materialize: true, filter: { tags: { category: 'work' } },
  });
  const row: TypedMaterializedRecord<Note> | undefined = values.records[0];
  const title: string | undefined = row?.value.title;
  const idle = useRecords(protocol, 'folder', null);
  const reusableOptions: RecordsOptions<typeof protocol.definition, 'folder/note'> = {
    within: 'parent', pagination: { limit: 5 },
  };
  const reusable: RecordsResult<TypedRecord<Note> | TypedMaterializedRecord<Note>> =
    useRecords(protocol, 'folder/note', reusableOptions);
  void reusable;
  const create = useEnboxMutation(async (enbox, data: Note) =>
    enbox.using(protocol).records.create('folder/note', { data, parentContextId: 'parent' }));
  const result: Promise<TypedRecord<Note>> = create.run({ title: 'Hello' });
  const current: boolean = create.isCurrent();
  void current;
  void result;
  void handle;
  void title;
  void idle;
  const contexts = createContextStore(async () => bound!.contexts.observe());
  const contextState = useContextView(contexts);
  const selectedContext = contextState.contexts[0];
  void selectedContext;
  // @ts-expect-error context catalogs preserve the native contexts shape
  contextState.records;
  // @ts-expect-error invalid literal path
  useRecords(protocol, 'other', { pagination: { limit: 1 } });
  // @ts-expect-error nested views require the exact context selector
  useRecords(protocol, 'folder/note', { pagination: { limit: 1 } });
  // @ts-expect-error invalid tag key must not widen the path or definition
  useRecords(protocol, 'folder/note', { within: 'parent', pagination: { limit: 1 }, filter: { tags: { other: 'x' } } });
  // @ts-expect-error invalid tag enum
  useRecords(protocol, 'folder/note', { within: 'parent', pagination: { limit: 1 }, filter: { tags: { category: 'invalid' } } });
  // @ts-expect-error decoded note does not have folder fields
  row?.value.name;
  // @ts-expect-error mutation variables remain inferred
  create.run({ title: 123 });
  // @ts-expect-error native protocol payloads remain inferred
  bound?.records.create('folder/note', { parentContextId: 'parent', data: { name: 'bad' } });
  // @ts-expect-error signal ownership remains with the hook
  useRecords(protocol, 'folder', { pagination: { limit: 1 }, signal: new AbortController().signal });
  return <EnboxProvider client={client}>{title}</EnboxProvider>;
}

export function OwnedContract(): React.ReactNode {
  return <EnboxProvider config={{ application, wallet: { appName: 'Notes' } }}><Contract /></EnboxProvider>;
}

// @ts-expect-error client ownership cannot be configured in two ways
const invalidProvider = <EnboxProvider client={client} config={{ application }} />;
void invalidProvider;

// @ts-expect-error manifest configuration cannot be overridden
createEnboxClient({ application, connection: { application } });
// @ts-expect-error wallet and handler configuration are mutually exclusive
createEnboxClient({ application, wallet: {}, connectHandler: { requestAccess: async () => undefined } });
