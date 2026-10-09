import type { ConnectionSnapshot } from '@enbox/browser';

import { describe, expect, it, vi } from 'vitest';

import { subscribeToConnectionBinding } from '../src/internal/connection-binding.js';
import { connected, controlledClient } from './helpers.js';

describe('connection binding subscriptions', () => {
  it('detaches the abort listener even when the store unsubscribe throws', () => {
    const lifetime = new AbortController();
    const initial = connected(undefined, undefined, lifetime);
    const { client, listeners } = controlledClient(initial);
    const failure = new Error('unsubscribe failed');
    const store = {
      ...client,
      subscribe: (notify: (snapshot: ConnectionSnapshot) => void) => {
        const unsubscribe = client.subscribe(notify);
        return () => { unsubscribe(); throw failure; };
      },
    };
    const notify = vi.fn();
    const unsubscribe = subscribeToConnectionBinding(store, initial, notify);
    expect(() => unsubscribe()).toThrow(failure);
    lifetime.abort();
    expect(notify).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
