import type { FormEvent } from 'react';

import { useState } from 'react';
import {
  EnboxProvider,
  useEnboxConnection,
  useEnboxMutation,
  useRecords,
} from '@enbox/react';

import type { Note } from './application.js';
import { config, NotesProtocol } from './application.js';

function Notes() {
  const [title, setTitle] = useState('');
  const notes = useRecords(NotesProtocol, 'note', { materialize: true, pagination: { limit: 20 } });
  const createNote = useEnboxMutation(async (enbox, data: Note) =>
    enbox.using(NotesProtocol).records.create('note', { data }));
  const deleteNote = useEnboxMutation(async (enbox, recordId: string) =>
    enbox.using(NotesProtocol).records.delete('note', { recordId }));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const submitted = title.trim();
    try {
      await createNote.run({ title: submitted });
      // Clear only the submitted draft while its connection binding is still active.
      if (createNote.isCurrent()) {
        setTitle((draft) => draft.trim() === submitted ? '' : draft);
      }
    } catch {
      // The current mutation's error is rendered below; the draft remains.
    }
  }

  return (
    <section>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="title">New note</label>
        <input id="title" value={title} maxLength={500} onChange={(event) => setTitle(event.target.value)} required />
        <button disabled={createNote.isPending || title.trim() === ''}>Save note</button>
      </form>
      {createNote.error && <p role="alert">{createNote.error.message}</p>}
      {deleteNote.error && <p role="alert">{deleteNote.error.message}</p>}
      {notes.error && <p role="alert">{notes.error.message}</p>}
      {notes.status === 'loading' && <p>Opening saved notes…</p>}
      {notes.status === 'ready' && !notes.current && <p>Showing saved notes while your wallet catches up.</p>}
      <ul>
        {notes.records.map(({ record, value }) => (
          <li key={record.id}>
            <span>{value.title}</span>
            <button type="button" disabled={deleteNote.isPending} onClick={() => { void deleteNote.run(record.id).catch(() => {}); }}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {notes.hasMore && <button disabled={notes.isLoadingMore} onClick={() => { void notes.loadMore().catch(() => {}); }}>More notes</button>}
    </section>
  );
}

function WalletNotes() {
  const connection = useEnboxConnection();
  const pending = connection.isConnecting || connection.isDisconnecting;
  return (
    <main>
      <h1>My notes</h1>
      <p>Private notes saved with your wallet.</p>
      {connection.connectionError && <p role="alert">{connection.connectionError.message}</p>}
      {(!connection.isConnected || connection.walletRepair) && (
        <button disabled={pending} onClick={() => { void connection.connect().catch(() => {}); }}>
          {pending ? 'Connecting…' : connection.walletRepair ? 'Renew wallet access' : 'Connect wallet'}
        </button>
      )}
      {connection.isConnected && (
        <>
          <p>{connection.identityName || 'Wallet connected'}</p>
          <Notes key={connection.did} />
          <button disabled={pending} onClick={() => { void connection.disconnect().catch(() => {}); }}>Disconnect</button>
        </>
      )}
    </main>
  );
}

export function App() {
  return <EnboxProvider config={config}><WalletNotes /></EnboxProvider>;
}
