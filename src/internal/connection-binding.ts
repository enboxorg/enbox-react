import type { ConnectionSnapshot, ConnectionStore } from '@enbox/browser';

/** Captured facade/session references; the same DID can acquire replacement objects. */
export type ConnectionBinding = Readonly<{
  enbox: ConnectionSnapshot['enbox'];
  session: ConnectionSnapshot['session'];
}>;

export function selectConnectionBinding(snapshot: ConnectionSnapshot): ConnectionBinding {
  return { enbox: snapshot.enbox, session: snapshot.session };
}

export function sameConnectionBinding(previous: Partial<ConnectionBinding>, next: Partial<ConnectionBinding>): boolean {
  return previous.enbox === next.enbox && previous.session === next.session;
}

export function isConnectionBindingCurrent(client: ConnectionStore, expected: Partial<ConnectionBinding>): boolean {
  return sameConnectionBinding(client.getSnapshot(), expected)
    && expected.session?.signal.aborted !== true;
}

/** Session abort can precede the store publishing its replacement snapshot. */
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
