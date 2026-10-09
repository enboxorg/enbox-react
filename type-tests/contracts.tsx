import type { TypedMaterializedRecord, TypedRecord } from '@enbox/browser';
import type { RecordsOptions, RecordsResult } from '@enbox/react';

import { EnboxProvider, useEnboxMutation, useProtocol, useRecords } from '@enbox/react';
import { createEnboxClient, defineApplicationManifest, defineProtocol, recordCodecs } from '@enbox/react/config';

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

export function Contract(): React.ReactNode {
  const bound = useProtocol(protocol);
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
  void result;
  void handle;
  void title;
  void idle;
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

// @ts-expect-error manifest configuration cannot be overridden
createEnboxClient({ application, connection: { application } });
// @ts-expect-error wallet and handler configuration are mutually exclusive
createEnboxClient({ application, wallet: {}, connectHandler: { requestAccess: async () => undefined } });
