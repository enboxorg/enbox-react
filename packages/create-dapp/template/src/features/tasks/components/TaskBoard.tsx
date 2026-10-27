import type { StoreInstance } from '@enbox/browser';
import { useFeature, useStore } from '@enbox/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { TaskBoardStore } from '../store.js';
import './tasks.css';

type TaskState = ReturnType<StoreInstance<typeof TaskBoardStore>['activeTasks']['getSnapshot']>;

export function TaskBoard({ disabled = false }: { disabled?: boolean }) {
  const board = useFeature(TaskBoardStore);
  const projects = useStore(board.projects);
  const activeTasks = useStore(board.activeTasks);
  const creation = useStore(board.projects.create);
  const projectContextId = activeTasks.selection;
  const [name, setName] = useState('');
  const creating = creation.pendingCount > 0;
  const prompt = projects.status === 'loading' ? 'Loading projects…'
    : projects.status === 'ready' && projects.records.length === 0 ? 'Create your first project to get started.'
      : 'Select a project to see its tasks.';
  async function addProject(event: FormEvent) {
    event.preventDefault();
    try {
      const record = await board.createProject(name);
      if (board.projects.create.isCurrent()) {
        setName('');
        await board.activeTasks.select(record.contextId);
      }
    } catch { /* The command exposes the error below. */ }
  }
  return (
    <section className="panel demo" aria-labelledby="demo-title">
      <h2 id="demo-title">Your projects</h2>
      <p>A private task board. Create a project, add tasks, and make a little progress.</p>
      <form className="demo-form" onSubmit={addProject}>
        <label htmlFor="project-name">Project name</label>
        <input id="project-name" value={name} maxLength={60} required
          disabled={disabled || creating} onChange={(event) => setName(event.target.value)} />
        <button className="button button-secondary" disabled={disabled || creating || !name.trim()}>
          {creating ? 'Creating…' : 'Create project'}
        </button>
      </form>
      {creation.error && <p role="alert">Couldn’t create the project: {creation.error.message}</p>}
      {projects.status === 'error' && <div role="alert">
        <p>Couldn’t load projects: {projects.error.message}</p>
        <button type="button" disabled={disabled} onClick={() => { void board.projects.retry().catch(() => {}); }}>Try again</button>
      </div>}
      <div className="project-picker" role="group" aria-label="Projects">
        {projects.records.map(({ record, value }) => <button type="button" className="button button-quiet" key={record.id} disabled={disabled}
          aria-pressed={record.contextId === projectContextId} onClick={() => { void board.activeTasks.select(record.contextId).catch(() => {}); }}>{value.name}</button>)}
      </div>
      {projects.hasMore && <button type="button" disabled={disabled || projects.isLoadingMore}
        onClick={() => { void board.projects.loadMore().catch(() => {}); }}>More projects</button>}
      {projectContextId !== null
        ? <ProjectTasks key={projectContextId} within={projectContextId} tasks={activeTasks} disabled={disabled} />
        : <p role="status">{prompt}</p>}
    </section>
  );
}

function ProjectTasks({ within, tasks, disabled }: {
  within: string; tasks: TaskState; disabled: boolean;
}) {
  const board = useFeature(TaskBoardStore);
  const taskCollection = board.tasks.within(within);
  const creation = useStore(taskCollection.create);
  const updates = useStore(taskCollection.patch);
  const [title, setTitle] = useState('');
  // Reopening the same record creates a new UI target for completion guards.
  const [selection, setSelection] = useState<{ id: string }>();
  const creating = creation.pendingCount > 0;
  async function addTask(event: FormEvent) {
    event.preventDefault();
    try {
      const record = await board.createTask({ within, title });
      if (taskCollection.create.isCurrent()) { setSelection({ id: record.id }); setTitle(''); }
    } catch { /* The scoped create command exposes the error below. */ }
  }
  return <div className="project-content">
    <h3>Tasks</h3>
    <form className="demo-form" onSubmit={addTask}>
      <label htmlFor="task-title">New task</label>
      <input id="task-title" value={title} maxLength={120} required
        disabled={disabled || creating} onChange={(event) => setTitle(event.target.value)} />
      <button className="button button-secondary" disabled={disabled || creating || !title.trim()}>Add task</button>
    </form>
    {creation.error && <p role="alert">Couldn’t add the task: {creation.error.message}</p>}
    {updates.error && <p role="alert">Couldn’t update the task: {updates.error.message}</p>}
    {tasks.status === 'error' && <p role="alert">Couldn’t load tasks. <button type="button"
      disabled={disabled} onClick={() => { void taskCollection.retry().catch(() => {}); }}>Retry tasks</button></p>}
    <ul className="task-list">
      {(tasks.records ?? []).map(({ record, value }) => <li key={record.id} data-completed={value.completed}>
        <input type="checkbox" aria-label={`Complete ${value.title}`} checked={value.completed}
          disabled={disabled || updates.pendingInputs.some((input) => input.id === record.id)}
          onChange={(event) => { void taskCollection.patch.run({ id: record.id, patch: { completed: event.currentTarget.checked } }).catch(() => {}); }} />
        <button type="button" className="button button-quiet" aria-label={`Open task ${value.title}`}
          disabled={disabled} aria-pressed={record.id === selection?.id} onClick={() => setSelection({ id: record.id })}>{value.title}</button>
      </li>)}
    </ul>
    {tasks.hasMore && <button type="button" disabled={disabled || tasks.isLoadingMore}
      onClick={() => { void taskCollection.loadMore().catch(() => {}); }}>More tasks</button>}
    {selection !== undefined
      ? <TaskDetails key={selection.id} within={within} recordId={selection.id} disabled={disabled}
        onClose={() => setSelection((current) => current === selection ? undefined : current)} />
      : <p role="status">Select a task to see its details.</p>}
  </div>;
}

function TaskDetails({ within, recordId, disabled, onClose }: {
  within: string; recordId: string; disabled: boolean; onClose: () => void;
}) {
  const board = useFeature(TaskBoardStore);
  const taskCollection = board.tasks.within(within);
  const list = useStore(taskCollection);
  const listed = list.records.some((row) => row.record.id === recordId);
  // A bounded window cannot prove an unlisted record is missing. Reuse loaded
  // rows, and acquire a single-record view only while that proof is unavailable.
  const needsLookup = !listed && (list.status !== 'ready' || list.hasMore);
  const details = useStore(needsLookup ? board.taskById(within, recordId) : taskCollection);
  const task = details.records.find((row) => row.record.id === recordId);
  const status = details.status;
  const updates = useStore(taskCollection.patch);
  const deletion = useStore(taskCollection.delete);
  const [draft, setDraft] = useState<string>();
  const pending = updates.pendingInputs.some((input) => input.id === recordId) || deletion.pendingInputs.includes(recordId);
  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    if (draft === undefined) return;
    try {
      await board.renameTask({ within, id: recordId, title: draft });
      if (taskCollection.patch.isCurrent()) setDraft(undefined);
    } catch { /* The scoped patch command exposes the error below. */ }
  }
  async function deleteTask() {
    try {
      await taskCollection.delete.run(recordId);
      if (taskCollection.delete.isCurrent()) onClose();
    } catch { /* The scoped delete command exposes the error below. */ }
  }
  const data = task?.value;
  return <section className="task-details" aria-label="Task details">
    <h3>Task details</h3>
    {status === 'error' && <p role="alert">Couldn’t load the task. <button type="button"
      disabled={disabled} onClick={() => {
        void (needsLookup ? board.taskById(within, recordId) : taskCollection).retry().catch(() => {});
      }}>Retry task</button></p>}
    {data === undefined && status === 'loading' && <p role="status">Loading task…</p>}
    {data === undefined && status === 'ready' && <p role="status">This task is no longer available.</p>}
    {data !== undefined && <>
      <p>{data.title} · {data.completed ? 'Completed' : 'To do'}</p>
      {draft === undefined
        ? <button type="button" className="button button-quiet" disabled={disabled || pending}
          onClick={() => setDraft(data.title)}>Edit title</button>
        : <form className="demo-form" onSubmit={saveTitle}>
          <label htmlFor="edit-task-title">Task title</label>
          <input id="edit-task-title" value={draft} maxLength={120} required disabled={disabled || pending}
            onChange={(event) => setDraft(event.target.value)} />
          <button className="button button-secondary" disabled={disabled || pending || !draft.trim()}>Save title</button>
          <button type="button" className="button button-quiet" disabled={disabled || pending} onClick={() => setDraft(undefined)}>Cancel</button>
        </form>}
      <button type="button" className="button button-quiet" disabled={disabled || pending} onClick={deleteTask}>Delete task</button>
    </>}
    {updates.error && <p role="alert">Couldn’t update the task: {updates.error.message}</p>}
    {deletion.error && <p role="alert">Couldn’t delete the task: {deletion.error.message}</p>}
    <button type="button" className="button button-quiet" onClick={onClose}>Close details</button>
  </section>;
}
