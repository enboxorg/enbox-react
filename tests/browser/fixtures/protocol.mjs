import assert from 'node:assert/strict';
import { createEnboxTestContext } from '@enbox/api/testing';
import { createRecordStore, defineApplicationManifest } from '@enbox/react/config';

import app from '../src/app.json' with { type: 'json' };
import { TaskBoardProtocol } from '../src/demo/protocol.ts';

assert.notEqual(app.id, app.name, 'The consumer must exercise distinct stable ID and display name.');
assert.equal(TaskBoardProtocol.definition.protocol, `https://example.com/${encodeURIComponent(app.id)}/demo/v2`);
const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [TaskBoardProtocol] }) });
const snapshot = Object.freeze({ phase: 'connected', enbox: context.enbox, session: context.session });
const client = { getSnapshot: () => snapshot, subscribe: () => () => {} };
const projects = createRecordStore({ client, protocol: TaskBoardProtocol, path: 'project' });
let tasks;
let homeTasks;
try {
  const records = context.enbox.using(TaskBoardProtocol).records;
  const work = await projects.commands.create({ name: 'Work' });
  const home = await projects.commands.create({ name: 'Home' });
  tasks = createRecordStore({ client, protocol: TaskBoardProtocol, path: 'project/task', options: { within: work.contextId } });
  homeTasks = createRecordStore({ client, protocol: TaskBoardProtocol, path: 'project/task', options: { within: home.contextId } });
  const task = await tasks.commands.create({ title: 'Ship it', completed: false });
  const other = await homeTasks.commands.create({ title: 'Water the plants', completed: false });
  const completed = await tasks.commands.patch({ id: task.id, patch: { completed: true } });
  const renamed = await tasks.commands.patch({ id: task.id, patch: { title: 'Ship the task board' } });
  assert.ok(work.record.encryption && task.record.encryption && completed.record.encryption && renamed.record.encryption, 'Projects and task updates must remain encrypted.');
  assert.equal(renamed.id, task.id, 'Completing and renaming a task must preserve its ID.');
  assert.deepEqual(await (await records.read('project/task', task.id)).data.json(), { title: 'Ship the task board', completed: true });
  await assert.rejects(tasks.commands.create({ title: '', completed: false }), { name: 'RecordValidationError' });
  await assert.rejects(tasks.commands.patch({ id: task.id, patch: { completed: 'yes' } }), { name: 'RecordValidationError' });
  await assert.rejects(tasks.commands.patch({ id: other.id, patch: { completed: true } }), /selected parent context/);
  await tasks.ready();
  const selected = await tasks.query({ within: work.contextId, filter: { recordId: task.id } });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, task.id);
  assert.deepEqual(selected[0].data, { title: 'Ship the task board', completed: true });
  assert.deepEqual((await homeTasks.query({ within: home.contextId })).map((row) => row.id), [other.id], 'Each project must select its own tasks.');
  const reopened = await tasks.commands.patch({ id: task.id, patch: { completed: false } });
  assert.deepEqual(reopened.data, { title: 'Ship the task board', completed: false });
  await tasks.commands.delete(task.id);
  assert.equal(await records.read('project/task', task.id), undefined);
  assert.equal((await records.query('project/task', { within: work.contextId })).records.length, 0);
  console.log('Starter shared records passed: encrypted projects, scoped tasks, completion/reopening, selected-record reads, and codec validation.');
} finally {
  try { await Promise.all([projects.close(), tasks?.close(), homeTasks?.close()]); }
  finally { await context.close(); }
}
