import { useState } from 'react';
import type { FormEvent } from 'react';

import { CHOICES } from './protocol.js';
import { useNotes, useSpaceChoice, useSpaces } from './use-demo.js';
import './demo.css';

export function Demo({ disabled = false }: { disabled?: boolean }) {
  const spaces = useSpaces();
  const [selectedId, setSelectedId] = useState<string>();
  const [name, setName] = useState('');
  const selected = spaces.records.find((space) => space.id === selectedId) ?? spaces.records[0];
  async function addSpace(event: FormEvent) {
    event.preventDefault();
    try {
      const record = await spaces.create.mutateAsync({ name: name.trim() });
      if (spaces.create.isCurrent()) { setSelectedId(record.id); setName(''); }
    } catch { /* The mutation's error is rendered below. */ }
  }
  return (
    <section className="panel demo" aria-labelledby="demo-title">
      <h2 id="demo-title">Your spaces</h2>
      <p>Create a space, add private notes, and give each space a little hello.</p>
      <form className="demo-form" onSubmit={addSpace}>
        <label htmlFor="space-name">Space name</label>
        <input id="space-name" value={name} maxLength={60} required
          disabled={disabled || spaces.create.isPending} onChange={(event) => setName(event.target.value)} />
        <button className="button button-secondary" disabled={disabled || spaces.create.isPending || !name.trim()}>
          {spaces.create.isPending ? 'Creating…' : 'Create space'}
        </button>
      </form>
      {spaces.create.error && <p role="alert">Couldn’t create the space: {spaces.create.error.message}</p>}
      {spaces.status === 'error' && <div role="alert">
        <p>Couldn’t load spaces: {spaces.error.message}</p>
        <button type="button" disabled={disabled} onClick={() => spaces.retry()}>Try again</button>
      </div>}
      <div className="space-picker" aria-label="Spaces">
        {spaces.records.map((space) => <button type="button" className="button button-quiet" key={space.id} disabled={disabled}
          aria-pressed={space.id === selected?.id} onClick={() => setSelectedId(space.id)}>{space.data.name}</button>)}
      </div>
      {spaces.hasMore && <button type="button" disabled={disabled || spaces.isLoadingMore}
        onClick={() => spaces.loadMore()}>More spaces</button>}
      {selected?.contextId !== undefined
        ? <SpaceContent key={selected.contextId} within={selected.contextId} disabled={disabled} />
        : <p role="status">{spaces.isLoading ? 'Loading spaces…' : 'Create your first space to get started.'}</p>}
    </section>
  );
}

function SpaceContent({ within, disabled }: { within: string; disabled: boolean }) {
  const notes = useNotes(within);
  const choice = useSpaceChoice(within);
  const [text, setText] = useState('');
  async function addNote(event: FormEvent) {
    event.preventDefault();
    try {
      await notes.create.mutateAsync({ text: text.trim(), done: false });
      if (notes.create.isCurrent()) setText('');
    } catch { /* The mutation's error is rendered below. */ }
  }
  const error = notes.create.error ?? notes.patch.error ?? notes.delete.error;
  return <div className="space-content">
    <h3>This space’s hello</h3>
    <fieldset className="choice-options" disabled={disabled || choice.set.isPending || !choice.isReady}>
      <legend className="sr-only">Choose your hello</legend>
      {CHOICES.map(({ emoji, label }) => <button type="button" className="choice-option" key={emoji}
        aria-label={`Choose ${label.toLowerCase()}`} aria-pressed={choice.data?.emoji === emoji}
        onClick={() => choice.set.mutate({ emoji })}>
        <span className="choice-emoji" aria-hidden="true">{emoji}</span><span>{label}</span>
      </button>)}
    </fieldset>
    <p role="status">{choice.set.isPending ? 'Saving your choice…' : choice.data ? `Saved: ${choice.data.emoji}` : 'Choose an emoji for this space.'}</p>
    {choice.set.error && <p role="alert">Couldn’t save: {choice.set.error.message}</p>}
    {choice.status === 'error' && <p role="alert">Couldn’t load the choice. <button type="button"
      disabled={disabled} onClick={() => choice.retry()}>Retry choice</button></p>}
    <h3>Notes in this space</h3>
    <form className="demo-form" onSubmit={addNote}>
      <label htmlFor="note-text">New note</label>
      <input id="note-text" value={text} maxLength={200} required
        disabled={disabled || notes.create.isPending} onChange={(event) => setText(event.target.value)} />
      <button className="button button-secondary" disabled={disabled || notes.create.isPending || !text.trim()}>Add note</button>
    </form>
    {error && <p role="alert">Couldn’t update the notes: {error.message}</p>}
    {notes.status === 'error' && <p role="alert">Couldn’t load notes. <button type="button"
      disabled={disabled} onClick={() => notes.retry()}>Retry notes</button></p>}
    <ul className="note-list">
      {notes.records.map((note) => <li key={note.id}>
        <label><input type="checkbox" checked={note.data.done} disabled={disabled || notes.patch.isPendingFor(note.id)}
          onChange={() => notes.patch.mutate({ id: note.id, patch: { done: !note.data.done } })} />{note.data.text}</label>
        <button type="button" className="button button-quiet" aria-label={`Delete note ${note.data.text}`} disabled={disabled || notes.delete.isPendingFor(note.id)}
          onClick={() => notes.delete.mutate(note.id)}>Delete</button>
      </li>)}
    </ul>
    {notes.hasMore && <button type="button" disabled={disabled || notes.isLoadingMore}
      onClick={() => notes.loadMore()}>More notes</button>}
  </div>;
}
