import { useEnboxConnection } from '@enbox/react';
import { useEffect } from 'react';

import app from '../app.json' with { type: 'json' };
import { TaskBoard } from '../features/tasks/components/TaskBoard.js';
import { ProfileCard } from '../components/ProfileCard.js';

export function App() {
  const connection = useEnboxConnection();
  const busy = connection.isConnecting || connection.isDisconnecting;
  useEffect(() => { document.title = app.name; }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="wordmark" href="./" aria-label={`${app.name} home`}>
          <span className="brand-symbol" aria-hidden="true">e</span>
          <span>Made with Enbox</span>
        </a>
        {connection.isConnected && (
          <button className="button button-quiet" type="button" disabled={busy}
            onClick={() => { void connection.disconnect().catch(() => {}); }}>
            {connection.isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </header>

      <main>
        <div className="intro">
          <p className="eyebrow">A small beginning</p>
          <h1>{app.name}</h1>
          <p>Bring your profile. Make a little space your own.</p>
        </div>

        {connection.walletRepair && (
          <div className="notice" role="status">
            <div>
              <strong>Reconnect your profile</strong>
              <p>Your wallet access needs a refresh before you can save.</p>
            </div>
            <button className="button button-secondary" type="button" disabled={busy}
              onClick={() => { void connection.connect().catch(() => {}); }}>
              {connection.isConnecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
          </div>
        )}
        {connection.connectionError && (
          <div className="notice notice-error" role="alert">
            <p>{connection.connectionError.message}</p>
          </div>
        )}

        {connection.isConnected && connection.did ? (
          <div className="connected-content">
            <ProfileCard enbox={connection.enbox} did={connection.did} identityName={connection.identityName} />
            <TaskBoard disabled={busy || connection.walletRepair !== undefined} />
          </div>
        ) : (
          <section className="panel connect-panel" aria-labelledby="connect-title">
            <div className="welcome-symbol" aria-hidden="true">✳</div>
            <h2 id="connect-title">A hello that belongs to you.</h2>
            <p>Connect your profile to make this space your own.</p>
            <button className="button button-primary" type="button" disabled={busy}
              onClick={() => { void connection.connect().catch(() => {}); }}>
              {connection.isConnecting ? 'Connecting…' : connection.isDisconnecting ? 'Disconnecting…' : 'Connect wallet'}
              {!busy && <span aria-hidden="true">↗</span>}
            </button>
            <p className="connect-caption">Your wallet will ask you to approve access.</p>
          </section>
        )}
      </main>
      <footer className="app-footer">Your identity. Your data. Your little corner of the web.</footer>
    </div>
  );
}
