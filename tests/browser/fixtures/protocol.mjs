import assert from 'node:assert/strict';
import { createEnboxTestContext } from '@enbox/api/testing';
import { defineApplicationManifest } from '@enbox/react/config';

import app from '../src/app.json' with { type: 'json' };
import { CHOICES, DemoProtocol } from '../src/demo/protocol.ts';

assert.notEqual(app.id, app.name, 'The consumer must exercise distinct stable ID and display name.');
assert.equal(DemoProtocol.definition.protocol, `https://example.com/${encodeURIComponent(app.id)}/demo/v2`);
const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [DemoProtocol] }) });
const views = [];
try {
  const records = context.enbox.using(DemoProtocol).records;
  const work = await records.create('space', { data: { name: 'Work' } });
  const home = await records.create('space', { data: { name: 'Home' } });
  const note = await records.create('space/note', { data: { text: 'Ship it', done: false }, parentContextId: work.contextId });
  const updated = await records.patch('space/note', note.id, { done: true });
  assert.ok(work.encryption && note.encryption && updated.encryption, 'Parents and children must remain encrypted.');
  assert.deepEqual(await updated.data.json(), { text: 'Ship it', done: true });
  const first = await records.set('space/choice', { data: { emoji: CHOICES[0].emoji }, within: work.contextId });
  const second = await records.set('space/choice', { data: { emoji: CHOICES[1].emoji }, within: work.contextId });
  assert.equal(second.id, first.id, 'Setting a scoped singleton must preserve its occupant.');
  const other = await records.set('space/choice', { data: { emoji: CHOICES[2].emoji }, within: home.contextId });
  assert.notEqual(other.id, first.id, 'Different parents must own different singletons.');
  assert.ok(first.encryption && second.encryption && other.encryption);
  await assert.rejects(records.set('space/choice', { data: { emoji: 'invalid' }, within: work.contextId }), { name: 'RecordValidationError' });
  for (const [parent, expected] of [[work, CHOICES[1].emoji], [home, CHOICES[2].emoji]]) {
    const view = await records.observe('space/choice', { within: parent.contextId, materialize: true, pagination: { limit: 1 } });
    views.push(view);
    const snapshot = await view.ready();
    assert.equal(snapshot.records.length, 1);
    assert.deepEqual(snapshot.records[0].value, { emoji: expected });
  }
  const empty = await records.query('space/note', { within: home.contextId });
  assert.equal(empty.records.length, 0, 'Notes must stay under their parent.');
  await records.delete('space/note', { recordId: note.id, within: work.contextId });
  assert.equal((await records.query('space/note', { within: work.contextId })).records.length, 0);
  console.log('Starter hierarchy passed: encrypted parents, scoped child CRUD, independent singletons, and codec validation.');
} finally {
  try { await Promise.all(views.map((view) => view.close())); }
  finally { await context.close(); }
}
