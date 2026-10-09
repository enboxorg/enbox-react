import type { PropsWithChildren } from 'react';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EnboxProvider, useConnection, useConnectionActions, useEnbox, useIdentity } from '../src/index.js';
import { connected, controlledClient } from './helpers.js';

describe('connection bindings', () => {
  it('borrows the client through Strict Mode replay and remount', () => {
    const { client, listeners } = controlledClient(connected());
    const wrapper = ({ children }: PropsWithChildren) =>
      <EnboxProvider client={client}>{children}</EnboxProvider>;
    const first = renderHook(() => useConnection(), { wrapper, reactStrictMode: true });
    expect(first.result.current.phase).toBe('connected');
    expect(client.initialize).toHaveBeenCalledTimes(2);
    first.unmount();
    expect(listeners.size).toBe(0);
    expect(client.dispose).not.toHaveBeenCalled();
    const second = renderHook(() => useConnection(), { wrapper, reactStrictMode: true });
    expect(second.result.current.phase).toBe('connected');
    second.unmount();
    expect(client.dispose).not.toHaveBeenCalled();
  });

  it('allows the host to initialize after worker bootstrap', () => {
    const { client } = controlledClient();
    renderHook(useConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    expect(client.initialize).not.toHaveBeenCalled();
  });

  it('does not rerender facade and identity consumers for sync-only changes', () => {
    const initial = connected();
    const { client, publish } = controlledClient(initial);
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return { enbox: useEnbox(), identity: useIdentity() };
    }, { wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider> });
    const before = renders;
    act(() => publish({ ...initial, sync: { state: 'caught-up', connectivity: 'online', remotes: [] } }));
    expect(renders).toBe(before);
    expect(hook.result.current.enbox).toBe(initial.enbox);
    expect(hook.result.current.identity).toBe(initial.session.identity);
  });

  it('applies selector changes immediately and preserves equal object projections', () => {
    const initial = connected();
    const { client, listeners, publish } = controlledClient(initial);
    let renders = 0;
    const hook = renderHook(({ selectIdentity }) => {
      renders += 1;
      return useConnection(
        (snapshot) => ({ value: selectIdentity ? snapshot.session?.did : snapshot.phase }),
        (previous, next) => previous.value === next.value,
      );
    }, {
      initialProps: { selectIdentity: false },
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    const selected = hook.result.current;
    const before = renders;
    act(() => publish({ ...initial, sync: { state: 'caught-up', connectivity: 'online', remotes: [] } }));
    expect(renders).toBe(before);
    expect(hook.result.current).toBe(selected);
    hook.rerender({ selectIdentity: true });
    expect(hook.result.current.value).toBe(initial.session.did);
    expect(listeners.size).toBe(1);
    hook.unmount();
    expect(listeners.size).toBe(0);
  });

  it('keeps a published facade available while smart repair is connecting', () => {
    const initial = connected();
    const { client, publish } = controlledClient(initial);
    const hook = renderHook(useEnbox, {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    act(() => publish({ ...initial, phase: 'connecting', walletReapprovalRequired: true }));
    expect(hook.result.current).toBe(initial.enbox);
    act(() => publish({ phase: 'disconnected', walletReapprovalRequired: true }));
    expect(hook.result.current).toBeUndefined();
  });

  it('provides stable bound actions and preserves native snapshot outcomes', async () => {
    const denied = { phase: 'disconnected' as const, error: new Error('denied') };
    const { client } = controlledClient(denied);
    const hook = renderHook(useConnectionActions, {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    const actions = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(actions);
    expect(await actions.connect()).toBe(client.getSnapshot());
    await actions.retryRemote('https://example.test');
    expect(client.retryRemote).toHaveBeenCalledWith('https://example.test');
  });

  it('requires a provider', () => {
    expect(() => renderHook(useEnbox)).toThrow('EnboxProvider');
  });
});
