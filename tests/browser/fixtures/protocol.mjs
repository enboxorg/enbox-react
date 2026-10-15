import assert from 'node:assert/strict';
import { createEnboxTestContext } from '@enbox/api/testing';
import { defineApplicationManifest } from '@enbox/react/config';

import app from '../src/app.json' with { type: 'json' };
import { CHOICES, DemoProtocol } from '../src/demo/protocol.ts';

assert.notEqual(app.id, app.name, 'The consumer must exercise distinct stable ID and display name.');
assert.equal(DemoProtocol.definition.protocol, `https://example.com/${encodeURIComponent(app.id)}/demo/v1`);
const context = await createEnboxTestContext({
  application: defineApplicationManifest({ protocols: [DemoProtocol] }),
});
let view;
try {
  const records = context.enbox.using(DemoProtocol).records;
  const first = await records.set('choice', { data: { emoji: CHOICES[0].emoji } });
  assert.ok(first.encryption, 'The initial choice must have native encryption metadata.');
  const second = await records.set('choice', { data: { emoji: CHOICES[1].emoji } });
  assert.equal(second.id, first.id, 'Setting a root singleton must update the same record.');
  assert.ok(second.encryption, 'The updated choice must remain encrypted.');
  await assert.rejects(records.set('choice', { data: { emoji: 'invalid' } }), {
    name: 'RecordValidationError',
  });

  view = await records.observe('choice', { materialize: true, pagination: { limit: 10 } });
  const snapshot = await view.ready();
  assert.equal(snapshot.records.length, 1, 'The singleton must have exactly one stored choice.');
  assert.equal(snapshot.records[0].record.id, first.id);
  assert.deepEqual(snapshot.records[0].value, { emoji: CHOICES[1].emoji });
  assert.equal(snapshot.hasMore, false);
  console.log('Starter protocol passed: encrypted singleton replacement, materialization, and codec validation.');
} finally {
  try {
    await view?.close();
  } finally {
    await context.close();
  }
}
