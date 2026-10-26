import { useState } from 'react';
import type { FormEvent } from 'react';

import { useProjects, useTask, useTasks } from './use-task-board.js';
import './demo.css';

export function TaskBoard({ disabled = false }: { disabled?: boolean }) {
  const projects = useProjects();
  const [projectContextId, setProjectContextId] = useState<string>();
  const [name, setName] = useState('');
  const prompt = projects.isLoading ? 'Loading projects…'
    : projects.isReady && projects.records.length === 0 ? 'Create your first project to get started.'
      : 'Select a project to see its tasks.';
  async function addProject(event: FormEvent) {
    event.preventDefault();
    try {
      const record = await projects.create.mutateAsync({ name: name.trim() });
      if (projects.create.isCurrent()) { setProjectContextId(record.contextId); setName(''); }
    } catch { /* The mutation error is rendered below. */ }
  }
  return (
    <section className="panel demo" aria-labelledby="demo-title">
      <h2 id="demo-title">Your projects</h2>
      <p>A private task board. Create a project, add tasks, and make a little progress.</p>
      <form className="demo-form" onSubmit={addProject}>
        <label htmlFor="project-name">Project name</label>
        <input id="project-name" value={name} maxLength={60} required
          disabled={disabled || projects.create.isPending} onChange={(event) => setName(event.target.value)} />
        <button className="button button-secondary" disabled={disabled || projects.create.isPending || !name.trim()}>
          {projects.create.isPending ? 'Creating…' : 'Create project'}
        </button>
      </form>
      {projects.create.error && <p role="alert">Couldn’t create the project: {projects.create.error.message}</p>}
      {projects.status === 'error' && <div role="alert">
        <p>Couldn’t load projects: {projects.error.message}</p>
        <button type="button" disabled={disabled} onClick={() => projects.retry()}>Try again</button>
      </div>}
      <div className="project-picker" role="group" aria-label="Projects">
        {projects.records.map((project) => <button type="button" className="button button-quiet" key={project.id} disabled={disabled}
          aria-pressed={project.contextId === projectContextId} onClick={() => setProjectContextId(project.contextId)}>{project.data.name}</button>)}
      </div>
      {projects.hasMore && <button type="button" disabled={disabled || projects.isLoadingMore}
        onClick={() => projects.loadMore()}>More projects</button>}
      {projectContextId !== undefined
        ? <ProjectTasks key={projectContextId} within={projectContextId} disabled={disabled} />
        : <p role="status">{prompt}</p>}
    </section>
  );
}

function ProjectTasks({ within, disabled }: { within: string; disabled: boolean }) {
  const tasks = useTasks(within);
  const [title, setTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  async function addTask(event: FormEvent) {
    event.preventDefault();
    try {
      const record = await tasks.create.mutateAsync({ title: title.trim(), completed: false });
      if (tasks.create.isCurrent()) { setSelectedId(record.id); setTitle(''); }
    } catch { /* The mutation error is rendered below. */ }
  }
  return <div className="project-content">
    <h3>Tasks</h3>
    <form className="demo-form" onSubmit={addTask}>
      <label htmlFor="task-title">New task</label>
      <input id="task-title" value={title} maxLength={120} required
        disabled={disabled || tasks.create.isPending} onChange={(event) => setTitle(event.target.value)} />
      <button className="button button-secondary" disabled={disabled || tasks.create.isPending || !title.trim()}>Add task</button>
    </form>
    {tasks.create.error && <p role="alert">Couldn’t add the task: {tasks.create.error.message}</p>}
    {tasks.patch.error && <p role="alert">Couldn’t update the task: {tasks.patch.error.message}</p>}
    {tasks.status === 'error' && <p role="alert">Couldn’t load tasks. <button type="button"
      disabled={disabled} onClick={() => tasks.retry()}>Retry tasks</button></p>}
    <ul className="task-list">
      {tasks.records.map((task) => <li key={task.id} data-completed={task.data.completed}>
        <input type="checkbox" aria-label={`Complete ${task.data.title}`} checked={task.data.completed}
          disabled={disabled || tasks.patch.isPendingFor(task.id)}
          onChange={(event) => tasks.patch.mutate({ id: task.id, patch: { completed: event.currentTarget.checked } })} />
        <button type="button" className="button button-quiet" aria-label={`Open task ${task.data.title}`}
          disabled={disabled} aria-pressed={task.id === selectedId} onClick={() => setSelectedId(task.id)}>{task.data.title}</button>
      </li>)}
    </ul>
    {tasks.hasMore && <button type="button" disabled={disabled || tasks.isLoadingMore}
      onClick={() => tasks.loadMore()}>More tasks</button>}
    {selectedId !== undefined
      ? <TaskDetails key={selectedId} within={within} recordId={selectedId} disabled={disabled} onClose={() => setSelectedId(undefined)} />
      : <p role="status">Select a task to see its details.</p>}
  </div>;
}

function TaskDetails({ within, recordId, disabled, onClose }: {
  within: string; recordId: string; disabled: boolean; onClose: () => void;
}) {
  const task = useTask(within, recordId);
  const [draft, setDraft] = useState<string>();
  const pending = task.patch.isPending || task.delete.isPending;
  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    if (draft === undefined) return;
    try {
      await task.patch.mutateAsync({ title: draft.trim() });
      if (task.patch.isCurrent()) setDraft(undefined);
    } catch { /* The mutation error is rendered below. */ }
  }
  async function deleteTask() {
    try {
      await task.delete.mutateAsync();
      if (task.delete.isCurrent()) onClose();
    } catch { /* The mutation error is rendered below. */ }
  }
  const data = task.data;
  return <section className="task-details" aria-label="Task details">
    <h3>Task details</h3>
    {task.status === 'error' && <p role="alert">Couldn’t load the task. <button type="button"
      disabled={disabled} onClick={() => task.retry()}>Retry task</button></p>}
    {data === undefined && task.isLoading && <p role="status">Loading task…</p>}
    {task.isMissing && <p role="status">This task is no longer available.</p>}
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
    {task.patch.error && <p role="alert">Couldn’t update the task: {task.patch.error.message}</p>}
    {task.delete.error && <p role="alert">Couldn’t delete the task: {task.delete.error.message}</p>}
    <button type="button" className="button button-quiet" onClick={onClose}>Close details</button>
  </section>;
}
