import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { EnboxProvider, EnboxResourceDrainError, useEnboxConnection, useEnboxResource } from '../src/index.js';
import { connected, controlledClient, deferred, facade } from './helpers.js';

it('owns one initialization per binding and accepts inline initializers', async () => {
  const { client, listeners } = controlledClient(connected());
  const resource = { close: vi.fn() };
  const open = vi.fn(async () => resource);
  const hook = renderHook(() => useEnboxResource(() => open()), {
    wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
  });
  await waitFor(() => expect(hook.result.current.data).toBe(resource));
  hook.rerender();
  expect(open).toHaveBeenCalledOnce();
  hook.unmount();
  expect(resource.close).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(0);
});

it('aborts an old initializer and disposes its late model without publishing it', async () => {
  const { client, publish } = controlledClient(connected());
  const pending = deferred<{ close(): void }>();
  const late = { close: vi.fn() };
  const current = { close: vi.fn() };
  const signals: AbortSignal[] = [];
  const open = vi.fn(({ signal }: { signal: AbortSignal }) => {
    signals.push(signal);
    return signals.length === 1 ? pending.promise : Promise.resolve(current);
  });
  const dispose = vi.fn((resource: { close(): void }) => { resource.close(); });
  const hook = renderHook(() => useEnboxResource(open, { dispose }), {
    wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
  });
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
  act(() => publish(connected(facade())));
  await waitFor(() => expect(hook.result.current.data).toBe(current));
  expect(signals[0]?.aborted).toBe(true);
  await act(async () => { pending.resolve(late); });
  expect(hook.result.current.data).toBe(current);
  expect(late.close).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledWith(late, expect.objectContaining({ wasPublished: false }));
  hook.unmount();
  expect(dispose).toHaveBeenCalledWith(current, expect.objectContaining({ wasPublished: true }));
  expect(current.close).toHaveBeenCalledOnce();
});

it('closes on session abort before the client publishes a replacement', async () => {
  const lifetime = new AbortController();
  const { client } = controlledClient(connected(facade(), 'did:example:one', lifetime));
  const resource = { close: vi.fn() };
  let signal!: AbortSignal;
  const hook = renderHook(() => useEnboxResource((context) => { signal = context.signal; return resource; }), {
    wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
  });
  await waitFor(() => expect(hook.result.current.data).toBe(resource));
  act(() => lifetime.abort());
  expect(signal.aborted).toBe(true);
  expect(hook.result.current.status).toBe('idle');
  expect(hook.result.current.data).toBeUndefined();
  expect(resource.close).toHaveBeenCalledOnce();
  hook.unmount();
  expect(resource.close).toHaveBeenCalledOnce();
});

it('surfaces initialization failures, aborts partial work, and retries without reviving old controls', async () => {
  const { client } = controlledClient(connected());
  const error = new Error('Model initialization failed');
  const resource = { close: vi.fn() };
  const signals: AbortSignal[] = [];
  const open = vi.fn(({ signal }: { signal: AbortSignal }) => {
    signals.push(signal);
    return signals.length === 1 ? Promise.reject(error) : Promise.resolve(resource);
  });
  const hook = renderHook(() => useEnboxResource(open), {
    wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
  });
  await waitFor(() => expect(hook.result.current.error).toBe(error));
  expect(signals[0]?.aborted).toBe(true);
  const retry = hook.result.current.retry;
  act(() => retry());
  await waitFor(() => expect(hook.result.current.data).toBe(resource));
  act(() => retry());
  expect(open).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it('does not start an abandoned Strict Mode initialization', async () => {
  const { client } = controlledClient(connected());
  const resource = { close: vi.fn() };
  const open = vi.fn(async () => resource);
  const hook = renderHook(() => useEnboxResource(open), {
    wrapper: ({ children }) => <StrictMode><EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider></StrictMode>,
  });
  await waitFor(() => expect(hook.result.current.data).toBe(resource));
  expect(open).toHaveBeenCalledOnce();
  hook.unmount();
  expect(resource.close).toHaveBeenCalledOnce();
});

it.each(['connect', 'disconnect'] as const)('drains owned models before native %s', async (action) => {
  const { client } = controlledClient(connected());
  const pending = deferred<void>();
  const resource = { close: vi.fn(), drain: vi.fn(() => pending.promise) };
  const hook = renderHook(() => ({ resource: useEnboxResource(() => resource), connection: useEnboxConnection() }), {
    wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
  });
  await waitFor(() => expect(hook.result.current.resource.data).toBe(resource));
  let issued!: Promise<void>;
  act(() => { issued = hook.result.current.connection[action](); });
  await waitFor(() => expect(resource.drain).toHaveBeenCalledOnce());
  expect(client[action]).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); await issued; });
  expect(client[action]).toHaveBeenCalledOnce();
  hook.unmount();
});

it('preserves a failed model drain until the caller explicitly chooses discard', async () => {
  const { client, publish } = controlledClient(connected());
  client.disconnect.mockImplementation(async () => { publish({ phase: 'disconnected' }); return client.getSnapshot(); });
  const cause = new Error('Pending application changes');
  const resource = { close: vi.fn(), drain: vi.fn(async () => { throw cause; }) };
  const hook = renderHook(() => ({ resource: useEnboxResource(() => resource), connection: useEnboxConnection() }), {
    wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
  });
  await waitFor(() => expect(hook.result.current.resource.data).toBe(resource));
  await act(async () => {
    await expect(hook.result.current.connection.disconnect()).rejects.toMatchObject({
      name: EnboxResourceDrainError.name, cause,
    });
  });
  expect(client.disconnect).not.toHaveBeenCalled();
  expect(resource.close).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.connection.disconnect({ skipBeforeDisconnect: true }); });
  expect(resource.drain).toHaveBeenCalledOnce();
  expect(client.disconnect).toHaveBeenCalledOnce();
  expect(resource.close).toHaveBeenCalledOnce();
  hook.unmount();
});

it('does not block wallet reapproval on writes whose grants already need repair', async () => {
  const { client } = controlledClient({ ...connected(), walletReapprovalRequired: true });
  const resource = { close: vi.fn(), drain: vi.fn(async () => { throw new Error('Expired grants'); }) };
  const hook = renderHook(() => ({ resource: useEnboxResource(() => resource), connection: useEnboxConnection() }), {
    wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider>,
  });
  await waitFor(() => expect(hook.result.current.resource.data).toBe(resource));
  await act(async () => { await hook.result.current.connection.connect(); });
  expect(resource.drain).not.toHaveBeenCalled();
  expect(client.connect).toHaveBeenCalledOnce();
  hook.unmount();
});
