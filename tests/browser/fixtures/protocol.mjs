import assert from 'node:assert/strict';
import { createEnboxTestContext } from '@enbox/api/testing';
import { defineApplicationManifest } from '@enbox/react/config';

import app from '../src/app.json' with { type: 'json' };
import { TaskBoardProtocol } from '../src/demo/protocol.ts';

assert.notEqual(app.id, app.name, 'The consumer must exercise distinct stable ID and display name.');
assert.equal(TaskBoardProtocol.definition.protocol, `https://example.com/${encodeURIComponent(app.id)}/demo/v2`);
const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [TaskBoardProtocol] }) });
let view;
try {
  const records = context.enbox.using(TaskBoardProtocol).records;
  const work = await records.create('project', { data: { name: 'Work' } });
  const home = await records.create('project', { data: { name: 'Home' } });
  const task = await records.create('project/task', { data: { title: 'Ship it', completed: false }, parentContextId: work.contextId });
  const other = await records.create('project/task', { data: { title: 'Water the plants', completed: false }, parentContextId: home.contextId });
  const completed = await records.patch('project/task', task.id, { completed: true });
  const renamed = await records.patch('project/task', task.id, { title: 'Ship the task board' });
  assert.ok(work.encryption && task.encryption && completed.encryption && renamed.encryption, 'Projects and task updates must remain encrypted.');
  assert.equal(renamed.id, task.id, 'Completing and renaming a task must preserve its ID.');
  assert.deepEqual(await (await records.read('project/task', task.id)).data.json(), { title: 'Ship the task board', completed: true });
  await assert.rejects(records.create('project/task', { data: { title: '', completed: false }, parentContextId: work.contextId }), { name: 'RecordValidationError' });
  await assert.rejects(records.patch('project/task', task.id, { completed: 'yes' }), { name: 'RecordValidationError' });
  view = await records.observe('project/task', { within: work.contextId, filter: { recordId: task.id }, materialize: true, pagination: { limit: 1 } });
  const snapshot = await view.ready();
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].record.id, task.id);
  assert.deepEqual(snapshot.records[0].value, { title: 'Ship the task board', completed: true });
  const homeTasks = await records.query('project/task', { within: home.contextId });
  assert.deepEqual(homeTasks.records.map((record) => record.id), [other.id], 'Each project must select its own tasks.');
  const reopened = await records.patch('project/task', task.id, { completed: false });
  assert.deepEqual(await reopened.data.json(), { title: 'Ship the task board', completed: false });
  await records.delete('project/task', { recordId: task.id, within: work.contextId });
  assert.equal(await records.read('project/task', task.id), undefined);
  assert.equal((await records.query('project/task', { within: work.contextId })).records.length, 0);
  console.log('Starter task board passed: encrypted projects, scoped tasks, completion/reopening, selected-record reads, and codec validation.');
} finally {
  try { await view?.close(); }
  finally { await context.close(); }
}
