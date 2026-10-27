import type { ConnectionSnapshot, ConnectionStore } from '@enbox/browser';

/** Facade/session identity and native session abort jointly fence guarded UI work. */
export function isConnectionBindingCurrent(
  client: ConnectionStore,
  expected: Pick<ConnectionSnapshot, 'enbox' | 'session'>,
): boolean {
  const current = client.getSnapshot();
  return current.enbox === expected.enbox && current.session === expected.session
    && expected.session?.signal.aborted !== true;
}
