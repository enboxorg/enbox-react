import { useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { defineProtocol, recordCodecs } from '@enbox/react/config';

const protocol = defineProtocol({
  protocol: 'https://example.test/scoped', published: false,
  types: { space: { dataFormats: ['application/json'] }, note: { dataFormats: ['application/json'] }, choice: { dataFormats: ['application/json'] }, member: { dataFormats: ['application/json'] } },
  structure: { space: { note: {}, choice: { $recordLimit: { max: 1 } }, member: { $role: true } } },
} as const, { space: recordCodecs.json<{ name: string }>(), note: recordCodecs.json<{ text: string; done: boolean }>(), choice: recordCodecs.json<{ emoji: string }>(), member: recordCodecs.json<{}>() });

export function Contract(): null {
  const spaces = useEnboxRecords(protocol, 'space');
  spaces.create.mutate({ name: 'Work' });
  const notes = useEnboxRecords(protocol, 'space/note', { within: 'parent' });
  notes.patch.mutate({ id: 'note', patch: { done: true } });
  notes.patch.mutate({ id: 'note', patch: (current) => ({ done: !current.done }) });
  const text: string | undefined = notes.records[0]?.data.text;
  void text;
  // @ts-expect-error schema cardinality does not make recordId optional
  useEnboxRecord(protocol, 'space/choice', { within: 'parent' });
  const one = useEnboxRecord(protocol, 'space/note', { within: 'parent', recordId: 'note' });
  one.patch.mutate({ text: 'Updated' });
  one.delete.mutate();
  const selectedOptions = { within: 'parent', recordId: 'choice' };
  const selectedChoice = useEnboxRecord(protocol, 'space/choice', selectedOptions);
  // @ts-expect-error selecting a singleton by ID must not expose logical set
  selectedChoice.set.mutate({ emoji: 'No' });
  useEnboxRecord(protocol, 'space/note', Math.random() > 0.5 ? null : { within: 'parent', recordId: 'note' });
  // @ts-expect-error single-record hooks require explicit options
  useEnboxRecord(protocol, 'space');
  // @ts-expect-error nested records require an explicit parent
  useEnboxRecords(protocol, 'space/note');
  // @ts-expect-error single-record hooks require both ID and parent
  useEnboxRecord(protocol, 'space/choice');
  // @ts-expect-error root records cannot accept a parent
  useEnboxRecords(protocol, 'space', { within: 'parent' });
  // @ts-expect-error role grants require the native role API
  useEnboxRecords(protocol, 'space/member', { within: 'parent' });
  // @ts-expect-error data shapes follow the codec
  notes.create.mutate({ name: 'Wrong' });
  // @ts-expect-error patches follow the codec
  notes.patch.mutate({ id: 'note', patch: { done: 'yes' } });
  // @ts-expect-error snapshots must be changed through commands
  notes.records[0]!.data.text = 'Changed';
  // @ts-expect-error an ID selection cannot replace a singleton
  one.set.mutate({ text: 'No' });
  // @ts-expect-error unknown protocol path
  useEnboxRecords(protocol, 'missing');
  // @ts-expect-error convenience commands only operate on local session data
  useEnboxRecords(protocol, 'space', { from: 'did:example:other' });
  return null;
}
