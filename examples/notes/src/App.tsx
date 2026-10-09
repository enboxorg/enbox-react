import type { FormEvent } from 'react';

import { isConnectDeniedError } from '@enbox/browser';
import { useState } from 'react';
import {
  EnboxProvider,
  useConnection,
  useConnectionActions,
  useEnboxClient,
  useEnboxMutation,
  useRecords,
} from '@enbox/react';

import type { Note } from './application.js';
import { NotesProtocol } from './application.js';
import { client } from './client.js';

function Notes() {
  const [title, setTitle] = useState('');
  const store = useEnboxClient();
  const notes = useRecords(NotesProtocol, 'note', { materialize: true, pagination: { limit: 20 } });
  const create = useEnboxMutation(async (enbox, data: Note) =>
    enbox.using(NotesProtocol).records.create('note', { data }));
  const remove = useEnboxMutation(async (enbox, recordId: string) =>
    enbox.using(NotesProtocol).records.delete('note', { recordId }));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const submitted = title.trim();
    const expected = store.getSnapshot();
    try {
      await create.run({ title: submitted });
      const current = store.getSnapshot();
      if (current.enbox === expected.enbox && current.session === expected.session) {
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
  const connection = useConnection();
  const actions = useConnectionActions();
  const pending = ['initializing', 'connecting', 'disconnecting'].includes(connection.phase);
  return (
    <main>
      <h1>My notes</h1>
      <p>Private notes saved with your wallet.</p>
      {connection.error && !isConnectDeniedError(connection.error) && <p role="alert">{connection.error.message}</p>}
      {(!connection.enbox || connection.walletReapprovalRequired) && (
        <button disabled={pending} onClick={() => void actions.connect()}>
          {pending ? 'Connecting…' : connection.walletReapprovalRequired ? 'Renew wallet access' : 'Connect wallet'}
        </button>
      )}
      {connection.enbox && (
        <>
          <p>{connection.session?.identity.name || 'Wallet connected'}</p>
          <Notes key={connection.session?.did} />
          <button disabled={pending} onClick={() => void actions.disconnect()}>Disconnect</button>
        </>
      )}
    </main>
  );
}

export function App() {
  return <EnboxProvider client={client}><WalletNotes /></EnboxProvider>;
}
