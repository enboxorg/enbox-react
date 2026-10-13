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
  const create = useEnboxMutation(async (enbox, data: Note) =>
    enbox.using(NotesProtocol).records.create('note', { data }));
  const remove = useEnboxMutation(async (enbox, recordId: string) =>
    enbox.using(NotesProtocol).records.delete('note', { recordId }));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const submitted = title.trim();
    try {
      await create.run({ title: submitted });
      if (create.isCurrent()) {
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
        <button disabled={create.isPending || title.trim() === ''}>Save note</button>
      </form>
      {create.error && <p role="alert">{create.error.message}</p>}
      {remove.error && <p role="alert">{remove.error.message}</p>}
      {notes.error && <p role="alert">{notes.error.message}</p>}
      {notes.status === 'loading' && <p>Opening saved notes…</p>}
      {notes.status === 'ready' && !notes.current && <p>Showing saved notes while your wallet catches up.</p>}
      <ul>
        {notes.records.map(({ record, value }) => (
          <li key={record.id}>
            <span>{value.title}</span>
            <button type="button" disabled={remove.isPending} onClick={() => { void remove.run(record.id).catch(() => {}); }}>
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
