import type { ConnectionSnapshot, ConnectionStore } from '@enbox/browser';

/** The exact facade and authorization session published by a connection. */
export type ConnectionBinding = Readonly<{
  enbox: ConnectionSnapshot['enbox'];
  session: ConnectionSnapshot['session'];
}>;

export function selectConnectionBinding(snapshot: ConnectionSnapshot): ConnectionBinding {
  return { enbox: snapshot.enbox, session: snapshot.session };
}

export function sameConnectionBinding(previous: ConnectionBinding, next: ConnectionBinding): boolean {
  return previous.enbox === next.enbox && previous.session === next.session;
}

export function isConnectionBindingCurrent(client: ConnectionStore, expected: ConnectionBinding): boolean {
  const current = client.getSnapshot();
  return current.enbox === expected.enbox
    && current.session === expected.session
    && expected.session?.signal.aborted !== true;
}

export function subscribeToConnectionBinding(
  client: ConnectionStore,
  expected: ConnectionBinding,
  notify: () => void,
): () => void {
  const unsubscribe = client.subscribe(notify);
  expected.session?.signal.addEventListener('abort', notify);
  return () => {
    try {
      unsubscribe();
    } finally {
      expected.session?.signal.removeEventListener('abort', notify);
    }
  };
}
