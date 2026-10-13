import type { ProfileReaderSource } from '@enbox/browser';
import { act, renderHook, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const urls = vi.hoisted(() => ({ acquire: vi.fn(() => ({
  url: 'blob:native-profile', release: vi.fn(), releaseAfter: vi.fn(),
})) }));
vi.mock('@enbox/browser', async (original) => ({
  ...await original<typeof import('@enbox/browser')>(),
  createBlobUrlPool: () => ({ acquire: urls.acquire, dispose: vi.fn() }),
}));

import { useProfile, useProfiles } from '../src/hooks/profiles.js';
import { deferred } from './helpers.js';

function profileRecord(name: string) {
  return { data: { json: async () => ({ displayName: name }), blob: async () => new Blob() } };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('profile state with the native SDK reader', () => {
  it.each(['off', 'lazy'] as const)('does not revive retired eager image demand for a fresh %s consumer', async (images) => {
    const realNow = Date.now;
    let advance = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + advance);
    const retiredDid = 'did:example:retired';
    const retainedDid = 'did:example:retained';
    let published = false;
    const source = { records: {
      query: vi.fn(async (request) => ({ status: { code: 200 },
        records: request.from === retainedDid || published ? [profileRecord(request.from === retainedDid ? 'Bob' : 'Alice')] : [],
      })),
      read: vi.fn(async (_request) => ({ status: { code: 404 } })),
    } } satisfies ProfileReaderSource;
    const release: Array<() => void> = [];
    try {
      const cachedText = renderHook(() => useProfile(source, retiredDid, { images: 'off' }));
      const retiredEager = renderHook(() => useProfile(source, retiredDid));
      const retainedText = renderHook(() => useProfile(source, retainedDid, { images: 'off' }));
      const retainedEager = renderHook(() => useProfile(source, retainedDid));
      release.push(cachedText.unmount, retiredEager.unmount, retainedText.unmount, retainedEager.unmount);
      await waitFor(() => expect(cachedText.result.current.status).toBe('not-found'));
      await waitFor(() => expect(retiredEager.result.current.status).toBe('not-found'));
      await waitFor(() => expect(retainedEager.result.current.status).toBe('settled'));
      cachedText.unmount();
      retiredEager.unmount();
      published = true;
      advance = 5_000;

      const fresh = renderHook(() => useProfile(source, retiredDid, { images }));
      release.push(fresh.unmount);
      await waitFor(() => expect(fresh.result.current.status).toBe('settled'));
      expect(fresh.result.current.displayName).toBe('Alice');
      expect(fresh.result.current.fields.avatar.status).toBe('idle');
      expect(fresh.result.current.fields.hero.status).toBe('idle');
      expect(source.records.query.mock.calls.filter(([request]) => request.from === retiredDid)).toHaveLength(3);
      expect(source.records.read.mock.calls.filter(([request]) => request.from === retiredDid)).toHaveLength(0);

      if (images === 'lazy') {
        await act(async () => { await fresh.result.current.loadImages(); });
        expect(source.records.read.mock.calls.filter(([request]) => request.from === retiredDid)).toHaveLength(2);
        expect(fresh.result.current.fields.avatar.status).toBe('not-found');
        expect(retainedText.result.current.fields.avatar.status).toBe('idle');
      }
    } finally {
      for (const stop of release) stop();
      await act(async () => { await Promise.resolve(); });
      clock.mockRestore();
    }
  });

  it('shares demanded image reads and only watches explicitly selected lazy DIDs', async () => {
    const alice = 'did:example:alice';
    const bob = 'did:example:bob';
    const source = { records: {
      query: vi.fn(async (request) => ({ status: { code: 200 }, records: [profileRecord(request.from)] })),
      read: vi.fn(async (_request) => ({ status: { code: 404 } })),
    } } satisfies ProfileReaderSource;
    const group = renderHook(() => useProfiles(source, [alice, bob], { images: 'lazy' }));
    const second = renderHook(() => useProfile(source, alice, { images: 'lazy' }));
    await waitFor(() => expect(group.result.current.get(bob)?.status).toBe('settled'));
    expect(source.records.query).toHaveBeenCalledTimes(2);
    expect(source.records.read).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.all([group.result.current.get(alice)!.loadImages(), second.result.current.loadImages()]);
    });
    expect(source.records.read).toHaveBeenCalledTimes(2);
    expect(source.records.read.mock.calls.every(([request]) => request.from === alice)).toBe(true);
    expect(source.records.query).toHaveBeenCalledTimes(3);
    expect(group.result.current.get(alice)?.fields.avatar.status).toBe('not-found');
    expect(group.result.current.get(bob)?.fields.avatar.status).toBe('idle');
    expect(second.result.current.fields.avatar.status).toBe('not-found');
    const unrequested = renderHook(() => useProfile(source, alice, { images: 'lazy' }));
    await waitFor(() => expect(unrequested.result.current.status).toBe('settled'));
    expect(unrequested.result.current.fields.avatar.status).toBe('idle');
    expect(source.records.query).toHaveBeenCalledTimes(3);
    expect(source.records.read).toHaveBeenCalledTimes(2);
  });

  it('retains usable lazy text while the image reader settles its own native root state', async () => {
    const query = deferred<{ status: { code: number }; records: ReturnType<typeof profileRecord>[] }>();
    const source = { records: {
      query: vi.fn().mockResolvedValueOnce({ status: { code: 200 }, records: [profileRecord('Alice')] })
        .mockImplementation(() => query.promise),
      read: vi.fn(async () => ({ status: { code: 404 } })),
    } } satisfies ProfileReaderSource;
    const lazy = renderHook(() => useProfile(source, 'did:example:alice', { images: 'lazy' }));
    await waitFor(() => expect(lazy.result.current.status).toBe('settled'));
    let pending!: Promise<void>;
    act(() => { pending = lazy.result.current.loadImages(); });
    await waitFor(() => expect(source.records.query).toHaveBeenCalledTimes(2));
    expect(lazy.result.current.status).toBe('loading');
    expect(lazy.result.current.fields.profile.status).toBe('loading');
    expect(lazy.result.current.displayName).toBe('Alice');
    await act(async () => {
      query.resolve({ status: { code: 200 }, records: [profileRecord('Alice')] });
      await pending;
    });
    expect(lazy.result.current.status).toBe('settled');
    expect(lazy.result.current.fields.profile.status).toBe('settled');
    expect(lazy.result.current.fields.avatar.status).toBe('not-found');
  });

  it('shares text reads and performs no image reads until a lazy consumer requests them', async () => {
    const query = vi.fn(async () => ({ status: { code: 200 }, records: [profileRecord('Alice')] }));
    const read = vi.fn(async () => ({ status: { code: 404 } }));
    const source = { records: { query, read } } satisfies ProfileReaderSource;
    const off = renderHook(() => useProfile(source, 'did:example:alice', { images: 'off' }));
    const lazy = renderHook(() => useProfile(source, 'did:example:alice', { images: 'lazy' }));
    await waitFor(() => expect(lazy.result.current.status).toBe('settled'));
    expect(off.result.current.status).toBe('settled');
    expect(lazy.result.current.fields.avatar.status).toBe('idle');
    expect(query).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(urls.acquire).not.toHaveBeenCalled();

    await act(async () => { await lazy.result.current.loadImages(); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(lazy.result.current.fields.avatar.status).toBe('not-found');
    expect(lazy.result.current.fields.hero.status).toBe('not-found');
    expect(lazy.result.current.status).toBe('settled');
    expect(off.result.current.status).toBe('settled');
    expect(off.result.current.fields.avatar.status).toBe('idle');
    expect(off.result.current.avatarUrl).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('retains text and successful avatars when the native hero field fails', async () => {
    const avatar = new Blob(['avatar']);
    const source = { records: {
      query: vi.fn(async () => ({ status: { code: 200 }, records: [profileRecord('Alice')] })),
      read: vi.fn(async (request) => request.filter.protocolPath === 'profile/avatar'
        ? { status: { code: 200 }, record: { data: { json: async () => ({}), blob: async () => avatar } } }
        : { status: { code: 400, detail: 'invalid image' } }),
    } } satisfies ProfileReaderSource;
    const hook = renderHook(() => useProfile(source, 'did:example:alice'));
    await waitFor(() => expect(hook.result.current.status).toBe('settled'));
    expect(hook.result.current).toMatchObject({ displayName: 'Alice', avatarUrl: 'blob:native-profile' });
    expect(hook.result.current.fields.avatar.status).toBe('settled');
    expect(hook.result.current.fields.hero).toMatchObject({ status: 'error', failure: { code: 400, retryable: false } });
    expect(hook.result.current.fields.hero.failure?.message).toContain('invalid image');
    expect(urls.acquire).toHaveBeenCalledOnce();
  });

  it('distinguishes missing profiles from terminal native query failures', async () => {
    const missing = { records: {
      query: async () => ({ status: { code: 200 }, records: [] }),
      read: vi.fn(async () => ({ status: { code: 404 } })),
    } } satisfies ProfileReaderSource;
    const failing = { records: {
      query: async () => ({ status: { code: 400, detail: 'malformed query' } }),
      read: vi.fn(async () => ({ status: { code: 404 } })),
    } } satisfies ProfileReaderSource;
    const missingHook = renderHook(() => useProfile(missing, 'did:example:missing'));
    const failingHook = renderHook(() => useProfile(failing, 'did:example:failure'));
    await waitFor(() => expect(missingHook.result.current.status).toBe('not-found'));
    await waitFor(() => expect(failingHook.result.current.status).toBe('error'));
    expect(missingHook.result.current.displayName).toBeUndefined();
    expect(failingHook.result.current.fields.profile.failure).toMatchObject({ code: 400, retryable: false });
    expect(failingHook.result.current.fields.profile.failure?.message).toContain('malformed query');
    expect(missing.records.read).not.toHaveBeenCalled();
    expect(failing.records.read).not.toHaveBeenCalled();
  });

  it('keeps a text-only consumer settled while a sibling downloads images', async () => {
    const image = deferred<{ status: { code: number } }>();
    const source = { records: {
      query: async () => ({ status: { code: 200 }, records: [profileRecord('Alice')] }),
      read: vi.fn(() => image.promise),
    } } satisfies ProfileReaderSource;
    const off = renderHook(() => useProfile(source, 'did:example:alice', { images: 'off' }));
    const eager = renderHook(() => useProfile(source, 'did:example:alice'));
    await waitFor(() => expect(off.result.current.status).toBe('settled'));
    expect(eager.result.current.status).toBe('loading');
    expect(off.result.current.fields.avatar.status).toBe('idle');
    await act(async () => { image.resolve({ status: { code: 404 } }); });
    await waitFor(() => expect(eager.result.current.status).toBe('settled'));
  });

  it('keeps server rendering inert and backward-compatible eager convenience', async () => {
    const source = { records: {
      query: vi.fn(async () => ({ status: { code: 200 }, records: [profileRecord('Alice')] })),
      read: vi.fn(async () => ({ status: { code: 404 } })),
    } } satisfies ProfileReaderSource;
    function Shell() {
      const state = useProfile(source, 'did:example:alice');
      return <output>{state.status}:{state.displayName ?? 'empty'}</output>;
    }
    expect(renderToString(<Shell />)).toContain('idle');
    expect(source.records.query).not.toHaveBeenCalled();
    expect(source.records.read).not.toHaveBeenCalled();
    expect(urls.acquire).not.toHaveBeenCalled();
    const legacy = renderHook(() => useProfile(source, 'did:example:alice'));
    await waitFor(() => expect(legacy.result.current.displayName).toBe('Alice'));
    await waitFor(() => expect(source.records.read).toHaveBeenCalledTimes(2));
  });
});
