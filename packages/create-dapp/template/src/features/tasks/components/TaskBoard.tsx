import type { StoreCollectionSelectionState, TypedMaterializedRecord } from '@enbox/browser';
import { useFeature, useStore } from '@enbox/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import type { Task } from '../protocol.js';
import { TaskBoardStore } from '../store.js';
import './tasks.css';

export function TaskBoard({ disabled = false }: { disabled?: boolean }) {
  const board = useFeature(TaskBoardStore);
  const projects = useStore(board.projects);
  const activeTasks = useStore(board.activeTasks);
  const creation = useStore(board.createProject);
  const paging = useStore(board.moreProjects);
  const projectContextId = activeTasks.parentContextId;
  const [name, setName] = useState('');
  const creating = creation.pendingCount > 0;
  const prompt = projects.status === 'loading' ? 'Loading projects…'
    : projects.status === 'ready' && projects.records.length === 0 ? 'Create your first project to get started.'
      : 'Select a project to see its tasks.';
  async function addProject(event: FormEvent) {
    event.preventDefault();
    try {
      const record = await board.createProject.run(name);
      if (board.createProject.isCurrent()) {
        setName('');
        await board.selectProject.run(record.contextId);
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
        <button type="button" disabled={disabled} onClick={() => { void board.retryProjects.run(); }}>Try again</button>
      </div>}
      <div className="project-picker" role="group" aria-label="Projects">
        {projects.records.map(({ record, value }) => <button type="button" className="button button-quiet" key={record.id} disabled={disabled}
          aria-pressed={record.contextId === projectContextId} onClick={() => { void board.selectProject.run(record.contextId); }}>{value.name}</button>)}
      </div>
      {projects.hasMore && <button type="button" disabled={disabled || paging.pendingCount > 0}
        onClick={() => { void board.moreProjects.run(); }}>More projects</button>}
      {projectContextId !== null
        ? <ProjectTasks key={projectContextId} within={projectContextId} tasks={activeTasks} disabled={disabled} />
        : <p role="status">{prompt}</p>}
    </section>
  );
}

function ProjectTasks({ within, tasks, disabled }: {
  within: string; tasks: StoreCollectionSelectionState<TypedMaterializedRecord<Task>>; disabled: boolean;
}) {
  const board = useFeature(TaskBoardStore);
  const resource = board.tasks.within(within);
  const creation = useStore(resource.create);
  const updates = useStore(resource.patch);
  const paging = useStore(board.moreTasks);
  const [title, setTitle] = useState('');
  // Reopening the same record creates a new UI target for completion guards.
  const [selection, setSelection] = useState<{ id: string }>();
  const creating = creation.pendingCount > 0;
  async function addTask(event: FormEvent) {
    event.preventDefault();
    try {
      const record = await board.createTask({ within, title });
      if (resource.create.isCurrent()) { setSelection({ id: record.id }); setTitle(''); }
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
      disabled={disabled} onClick={() => { void board.retryTasks.run(within); }}>Retry tasks</button></p>}
    <ul className="task-list">
      {tasks.records.map(({ record, value }) => <li key={record.id} data-completed={value.completed}>
        <input type="checkbox" aria-label={`Complete ${value.title}`} checked={value.completed}
          disabled={disabled || updates.pendingVariables.some((input) => input.id === record.id)}
          onChange={(event) => { void resource.patch.run({ id: record.id, patch: { completed: event.currentTarget.checked } }); }} />
        <button type="button" className="button button-quiet" aria-label={`Open task ${value.title}`}
          disabled={disabled} aria-pressed={record.id === selection?.id} onClick={() => setSelection({ id: record.id })}>{value.title}</button>
      </li>)}
    </ul>
    {tasks.hasMore && <button type="button" disabled={disabled || paging.pendingVariables.includes(within)}
      onClick={() => { void board.moreTasks.run(within); }}>More tasks</button>}
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
  const resource = board.tasks.within(within);
  const list = useStore(resource);
  const listed = list.records.some((row) => row.record.id === recordId);
  // A bounded window cannot prove an unlisted record is missing. Reuse loaded
  // rows, and acquire a single-record view only while that proof is unavailable.
  const needsLookup = !listed && (list.status !== 'ready' || list.hasMore);
  const selection = useStore(needsLookup ? board.taskById(within, recordId) : resource);
  const task = selection.records.find((row) => row.record.id === recordId);
  const status = selection.status;
  const updates = useStore(resource.patch);
  const deletion = useStore(resource.delete);
  const [draft, setDraft] = useState<string>();
  const pending = updates.pendingVariables.some((input) => input.id === recordId) || deletion.pendingVariables.includes(recordId);
  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    if (draft === undefined) return;
    try {
      await board.renameTask({ within, id: recordId, title: draft });
      if (resource.patch.isCurrent()) setDraft(undefined);
    } catch { /* The scoped patch command exposes the error below. */ }
  }
  async function deleteTask() {
    try {
      await resource.delete.run(recordId);
      if (resource.delete.isCurrent()) onClose();
    } catch { /* The scoped delete command exposes the error below. */ }
  }
  const data = task?.value;
  return <section className="task-details" aria-label="Task details">
    <h3>Task details</h3>
    {status === 'error' && <p role="alert">Couldn’t load the task. <button type="button"
      disabled={disabled} onClick={() => {
        if (needsLookup) void board.retryTask.run({ within, recordId });
        else void board.retryTasks.run(within);
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
