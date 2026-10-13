import type { PropsWithChildren } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnboxProvider, useEnboxConnection, EnboxBindingChangedError } from '../src/index.js';
import { connected, controlledClient, deferred, facade } from './helpers.js';
import { ConnectDeniedError } from '@enbox/browser';

describe('dapp connection workflow', () => {
  it('retires a borrowed provider guard and rejects its captured controls without disposing the client', async () => {
    const { client } = controlledClient(connected());
    const saving = deferred<void>();
    const beforeConnect = vi.fn(() => saving.promise);
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} beforeConnect={beforeConnect}>{children}</EnboxProvider>,
    });
    const captured = hook.result.current;
    let connecting!: Promise<void>;
    act(() => { connecting = captured.connect(); });
    const rejected = expect(connecting).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { await Promise.resolve(); });
    expect(beforeConnect).toHaveBeenCalledOnce();
    await act(async () => { hook.unmount(); await Promise.resolve(); await rejected; });
    await act(async () => { saving.resolve(); await Promise.resolve(); });
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.dispose).not.toHaveBeenCalled();
    await expect(captured.connect()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await expect(captured.disconnect()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await expect(captured.refreshDwnEndpoints()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await expect(captured.retryRemote('https://remote.test')).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(client.refreshDwnEndpoints).not.toHaveBeenCalled();
    expect(client.retryRemote).not.toHaveBeenCalled();
  });

  it('does not sign out a borrowed client after its provider retires during a save guard', async () => {
    const { client } = controlledClient(connected());
    const saving = deferred<void>();
    const beforeDisconnect = vi.fn(() => saving.promise);
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} beforeDisconnect={beforeDisconnect}>{children}</EnboxProvider>,
    });
    let disconnecting!: Promise<void>;
    act(() => { disconnecting = hook.result.current.disconnect(); });
    const rejected = expect(disconnecting).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { await Promise.resolve(); });
    expect(beforeDisconnect).toHaveBeenCalledOnce();
    await act(async () => { hook.unmount(); await Promise.resolve(); });
    await act(async () => { saving.resolve(); await rejected; });
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.dispose).not.toHaveBeenCalled();
  });

  it('keeps the workflow alive when its last hook consumer leaves a mounted provider', async () => {
    const { client } = controlledClient();
    const saving = deferred<void>();
    let connection!: ReturnType<typeof useEnboxConnection>;
    function Consumer() { connection = useEnboxConnection(); return null; }
    const tree = render(<EnboxProvider client={client} beforeConnect={() => saving.promise}><Consumer /></EnboxProvider>);
    let connecting!: Promise<void>;
    act(() => { connecting = connection.connect(); });
    await act(async () => { await Promise.resolve(); });
    tree.rerender(<EnboxProvider client={client} beforeConnect={() => saving.promise}>{null}</EnboxProvider>);
    await act(async () => { saving.resolve(); await connecting; });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.dispose).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('retires pending commands on client replacement even when both clients publish the same binding', async () => {
    const initial = connected();
    const first = controlledClient(initial);
    const second = controlledClient(initial);
    let selected = first.client;
    const saving = deferred<void>();
    const beforeConnect = vi.fn().mockReturnValueOnce(saving.promise).mockResolvedValue(undefined);
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={selected} beforeConnect={beforeConnect}>{children}</EnboxProvider>,
    });
    const captured = hook.result.current;
    let connecting!: Promise<void>;
    act(() => { connecting = captured.connect(); });
    const rejected = expect(connecting).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { await Promise.resolve(); });
    selected = second.client;
    await act(async () => { hook.rerender(); await Promise.resolve(); });
    await rejected;
    await act(async () => { await hook.result.current.connect(); });
    expect(second.client.connect).toHaveBeenCalledOnce();
    await act(async () => { saving.resolve(); await Promise.resolve(); });
    expect(first.client.connect).not.toHaveBeenCalled();
    await expect(captured.connect()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(first.client.dispose).not.toHaveBeenCalled();
    expect(second.client.dispose).not.toHaveBeenCalled();
  });

  it.each(['connect', 'disconnect'] as const)('preserves an issued native %s outcome after provider retirement', async (action) => {
    const { client } = controlledClient(connected());
    const issued = deferred<ReturnType<typeof client.getSnapshot>>();
    client[action].mockReturnValueOnce(issued.promise);
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current[action](); });
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await act(async () => { await Promise.resolve(); });
    expect(client[action]).toHaveBeenCalledOnce();
    await act(async () => { hook.unmount(); await Promise.resolve(); });
    expect(settled).toBe(false);
    const failure = new Error('issued native operation failed');
    const rejected = expect(pending).rejects.toBe(failure);
    issued.reject(failure);
    await rejected;
    expect(client.dispose).not.toHaveBeenCalled();
  });

  it('does not start approval through a session aborted during a save guard', async () => {
    const lifetime = new AbortController();
    const { client } = controlledClient(connected(facade(), 'did:example:alice', lifetime));
    const saving = deferred<void>();
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} beforeConnect={() => saving.promise}>{children}</EnboxProvider>,
    });
    let connecting!: Promise<void>;
    act(() => { connecting = hook.result.current.connect(); });
    const rejected = expect(connecting).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { await Promise.resolve(); });
    lifetime.abort();
    await act(async () => { saving.resolve(); await rejected; });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('preserves the provider workflow through StrictMode replay', async () => {
    const { client } = controlledClient(connected());
    const hook = renderHook(useEnboxConnection, { reactStrictMode: true,
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await act(async () => { await Promise.resolve(); await hook.result.current.connect(); });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.dispose).not.toHaveBeenCalled();
  });

  it('does not start approval after disconnect supersedes a pending connect guard', async () => {
    const { client } = controlledClient();
    const guard = deferred<void>();
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} beforeConnect={() => guard.promise}>{children}</EnboxProvider>,
    });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.connect(); });
    await act(async () => { await hook.result.current.disconnect(); await pending; });
    expect(hook.result.current.isConnecting).toBe(false);
    await act(async () => { guard.resolve(); await Promise.resolve(); });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('preserves an issued approval outcome when a disconnect guard fails', async () => {
    const { client } = controlledClient();
    const issued = deferred<ReturnType<typeof client.getSnapshot>>();
    const saving = deferred<void>();
    client.connect.mockReturnValueOnce(issued.promise);
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} beforeDisconnect={() => saving.promise}>{children}</EnboxProvider>,
    });
    let connecting!: Promise<void>;
    let settled = false;
    act(() => {
      connecting = hook.result.current.connect();
      void connecting.then(() => { settled = true; }, () => { settled = true; });
    });
    await act(async () => { await Promise.resolve(); });
    expect(client.connect).toHaveBeenCalledOnce();
    let disconnecting!: Promise<void>;
    act(() => { disconnecting = hook.result.current.disconnect(); });
    const saveFailure = new Error('save failed');
    const disconnected = expect(disconnecting).rejects.toBe(saveFailure);
    await act(async () => { await Promise.resolve(); saving.reject(saveFailure); await disconnected; });
    expect(settled).toBe(false);
    expect(hook.result.current.isConnecting).toBe(true);
    expect(client.disconnect).not.toHaveBeenCalled();
    const approvalFailure = new Error('approval failed');
    const connected = expect(connecting).rejects.toBe(approvalFailure);
    await act(async () => { issued.reject(approvalFailure); await connected; });
    expect(settled).toBe(true);
    expect(hook.result.current.isConnecting).toBe(false);
  });

  it('does not publish repair progress or run a guard after initialization outlives a cancelled connect', async () => {
    const { client, publish } = controlledClient({ phase: 'initializing' });
    const initialization = deferred<ReturnType<typeof client.getSnapshot>>();
    const disconnectGuard = deferred<void>();
    const beforeConnect = vi.fn();
    client.initialize.mockReturnValue(initialization.promise);
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}
        beforeConnect={beforeConnect} beforeDisconnect={() => disconnectGuard.promise}>
        {children}
      </EnboxProvider>,
    });
    let connecting!: Promise<void>;
    act(() => { connecting = hook.result.current.connect(); });
    await act(async () => { await Promise.resolve(); });
    expect(client.initialize).toHaveBeenCalledOnce();
    let disconnecting!: Promise<void>;
    act(() => { disconnecting = hook.result.current.disconnect(); });
    const disconnected = expect(disconnecting).rejects.toBeInstanceOf(EnboxBindingChangedError);
    await act(async () => { await connecting; });

    // Restore can finish while a disconnect guard is still pending. The
    // restored binding stays actionable, without an obsolete approval flow.
    const restored = { ...connected(), connection: { state: 'expired' }, walletReapprovalRequired: true } as const;
    await act(async () => {
      publish(restored);
      initialization.resolve(restored);
      await Promise.resolve();
    });
    expect(beforeConnect).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
    expect(hook.result.current.isConnecting).toBe(false);
    expect(hook.result.current.walletRepair).toEqual({ reason: 'expired', status: 'required' });
    await act(async () => { disconnectGuard.resolve(); await disconnected; });
    expect(hook.result.current.walletRepair).toEqual({ reason: 'expired', status: 'required' });
  });
  it('projects retained repair and keeps the reason while the native facade is replaced', async () => {
    const initial = { ...connected(), connection: { state: 'expired' }, walletReapprovalRequired: true } as const;
    const { client, publish } = controlledClient(initial);
    const approval = deferred<void>();
    client.connect.mockImplementation(async () => {
      publish({ ...initial, phase: 'connecting' });
      await approval.promise;
      const repaired = connected();
      publish(repaired);
      return repaired;
    });
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    expect(hook.result.current.walletRepair).toEqual({ reason: 'expired', status: 'required' });
    let connecting!: Promise<void>;
    act(() => { connecting = hook.result.current.connect(); });
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current.isConnected).toBe(true);
    expect(hook.result.current.did).toBe(initial.session.did);
    act(() => publish({ phase: 'connecting' }));
    expect(hook.result.current.isConnected).toBe(false);
    expect(hook.result.current.walletRepair).toEqual({ reason: 'expired', status: 'waiting' });
    await act(async () => { approval.resolve(); await connecting; });
    expect(hook.result.current.walletRepair).toBeUndefined();
  });

  it('shares disconnect progress across consumers and coalesces guard execution', async () => {
    const { client } = controlledClient(connected());
    const saving = deferred<void>();
    const beforeDisconnect = vi.fn(() => saving.promise);
    const wrapper = ({ children }: PropsWithChildren) =>
      <EnboxProvider client={client} beforeDisconnect={beforeDisconnect}>{children}</EnboxProvider>;
    // Multiple hooks within one provider must see the same workflow.
    const together = renderHook(() => [useEnboxConnection(), useEnboxConnection()] as const, { wrapper });
    let a!: Promise<void>; let b!: Promise<void>;
    act(() => { a = together.result.current[0].disconnect(); b = together.result.current[1].disconnect(); });
    expect(a).toBe(b);
    expect(together.result.current.every((item) => item.isDisconnecting)).toBe(true);
    expect(client.disconnect).not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); saving.resolve(); await a; });
    expect(beforeDisconnect).toHaveBeenCalledOnce();
    expect(client.disconnect).toHaveBeenCalledOnce();
    together.unmount();
  });

  it('preserves a connected session on guard failure and permits an explicit bypass', async () => {
    const { client } = controlledClient(connected());
    const failure = new Error('unsaved edits');
    const beforeDisconnect = vi.fn(async () => { throw failure; });
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} beforeDisconnect={beforeDisconnect}>{children}</EnboxProvider>,
    });
    await act(async () => { await expect(hook.result.current.disconnect()).rejects.toBe(failure); });
    expect(hook.result.current.isConnected).toBe(true);
    expect(hook.result.current.isDisconnecting).toBe(false);
    expect(client.disconnect).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.disconnect({ skipBeforeDisconnect: true }); });
    expect(beforeDisconnect).toHaveBeenCalledOnce();
    expect(client.disconnect).toHaveBeenCalledWith({});
  });

  it('does not disconnect a replacement identity after an awaited guard', async () => {
    const { client, publish } = controlledClient(connected());
    const saving = deferred<void>();
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client} beforeDisconnect={() => saving.promise}>{children}</EnboxProvider>,
    });
    let result!: Promise<void>;
    act(() => { result = hook.result.current.disconnect(); });
    const rejected = expect(result).rejects.toBeInstanceOf(EnboxBindingChangedError);
    act(() => publish(connected(facade(), 'did:example:bob')));
    await act(async () => { saving.resolve(); await rejected; });
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(hook.result.current.did).toBe('did:example:bob');
  });

  it('keeps denial quiet while rejecting actionable native connect errors', async () => {
    const { client, publish } = controlledClient();
    const denied = new ConnectDeniedError();
    client.connect.mockImplementationOnce(async () => {
      const result = { phase: 'disconnected' as const, error: denied };
      publish(result); return result;
    });
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider client={client}>{children}</EnboxProvider>,
    });
    await act(async () => { await hook.result.current.connect(); });
    expect(hook.result.current.connectionError).toBeUndefined();
    const failure = new Error('DWN unavailable');
    client.connect.mockImplementationOnce(async () => {
      const result = { phase: 'error' as const, error: failure };
      publish(result); return result;
    });
    await act(async () => { await expect(hook.result.current.connect()).rejects.toBe(failure); });
    expect(hook.result.current.connectionError).toBe(failure);
  });
});
