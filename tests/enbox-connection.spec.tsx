import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnboxProvider, useEnboxConnection, EnboxBindingChangedError } from '../src/index.js';
import { connected, controlledClient, deferred, facade } from './helpers.js';
import { ConnectDeniedError } from '@enbox/browser';

describe('dapp connection workflow', () => {
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
