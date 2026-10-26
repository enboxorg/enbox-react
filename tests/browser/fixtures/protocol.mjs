import assert from 'node:assert/strict';
import { createEnboxTestContext } from '@enbox/api/testing';
import { createRecordStore, createRecordsStore, defineApplicationManifest } from '@enbox/react/config';

import app from '../src/app.json' with { type: 'json' };
import { TaskBoardProtocol } from '../src/demo/protocol.ts';

assert.notEqual(app.id, app.name, 'The consumer must exercise distinct stable ID and display name.');
assert.equal(TaskBoardProtocol.definition.protocol, `https://example.com/${encodeURIComponent(app.id)}/demo/v2`);
const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [TaskBoardProtocol] }) });
const snapshot = Object.freeze({ phase: 'connected', enbox: context.enbox, session: context.session });
const client = { getSnapshot: () => snapshot, subscribe: () => () => {} };
const projectStore = createRecordsStore({ client, protocol: TaskBoardProtocol, path: 'project' });
let workTasks;
let homeTasks;
let detail;
try {
  const records = context.enbox.using(TaskBoardProtocol).records;
  const work = await projectStore.commands.create({ name: 'Work' });
  const home = await projectStore.commands.create({ name: 'Home' });
  workTasks = createRecordsStore({ client, protocol: TaskBoardProtocol, path: 'project/task', options: { within: work.contextId } });
  homeTasks = createRecordsStore({ client, protocol: TaskBoardProtocol, path: 'project/task', options: { within: home.contextId } });
  const task = await workTasks.commands.create({ title: 'Ship it', completed: false });
  const other = await homeTasks.commands.create({ title: 'Water the plants', completed: false });
  const completed = await workTasks.commands.patch({ id: task.id, patch: { completed: true } });
  const renamed = await workTasks.commands.patch({ id: task.id, patch: { title: 'Ship the task board' } });
  assert.ok(work.encryption && task.encryption && completed.encryption && renamed.encryption, 'Projects and task updates must remain encrypted.');
  assert.equal(renamed.id, task.id, 'Completing and renaming a task must preserve its ID.');
  assert.deepEqual(await (await records.read('project/task', task.id)).data.json(), { title: 'Ship the task board', completed: true });
  await assert.rejects(workTasks.commands.create({ title: '', completed: false }), { name: 'RecordValidationError' });
  await assert.rejects(workTasks.commands.patch({ id: task.id, patch: { completed: 'yes' } }), { name: 'RecordValidationError' });
  await assert.rejects(workTasks.commands.patch({ id: other.id, patch: { completed: true } }), /selected parent context/);
  detail = createRecordStore({ client, protocol: TaskBoardProtocol, path: 'project/task', options: { within: work.contextId, recordId: task.id } });
  const selected = await detail.ready();
  assert.equal(selected.record.id, task.id);
  assert.deepEqual(selected.data, { title: 'Ship the task board', completed: true });
  assert.deepEqual((await homeTasks.ready()).records.map((row) => row.id), [other.id], 'Each project must select its own tasks.');
  const reopened = await workTasks.commands.patch({ id: task.id, patch: { completed: false } });
  assert.deepEqual(await reopened.data.json(), { title: 'Ship the task board', completed: false });
  await workTasks.commands.delete(task.id);
  assert.equal(await records.read('project/task', task.id), undefined);
  assert.equal((await workTasks.ready()).records.length, 0);
  console.log('Starter controllers passed: parameterized record stores, encrypted CRUD, scoped tasks, selected-record reads, and codec validation.');
} finally {
  try { await Promise.all([projectStore.close(), workTasks?.close(), homeTasks?.close(), detail?.close()]); }
  finally { await context.close(); }
}
