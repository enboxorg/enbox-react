import type { ProfileReaderSource } from '@enbox/browser';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const snapshots = new Map<string, unknown>();
  const watchers = new Set<() => void>();
  const dispose = vi.fn();
  const watch = vi.fn((_dids: readonly string[], notify: () => void) => {
    watchers.add(notify); return () => { watchers.delete(notify); };
  });
  const createReader = vi.fn(() => ({ watch, getSnapshot: (did: string) => snapshots.get(did), dispose }));
  let nextUrl = 0;
  const releaseAfter = vi.fn();
  const acquire = vi.fn(() => ({ url: `blob:test-${nextUrl++}`, release: vi.fn(), releaseAfter }));
  return { snapshots, watchers, dispose, watch, createReader, acquire, releaseAfter };
});
vi.mock('@enbox/browser', async (original) => ({
  ...await original<typeof import('@enbox/browser')>(),
  createProfileReader: mocks.createReader,
  createBlobUrlPool: () => ({ acquire: mocks.acquire, dispose: vi.fn() }),
}));
import { useProfile, useProfiles } from '../src/index.js';
import { ProfilesObserver } from '../src/internal/profiles-observer.js';

function source(): ProfileReaderSource { return { records: {} } as ProfileReaderSource; }
function profile(name: string, avatar?: Blob) {
  return { profile: { value: { displayName: name } }, avatar: { value: avatar }, hero: {} };
}
beforeEach(() => {
  mocks.snapshots.clear(); mocks.watchers.clear(); vi.clearAllMocks();
});

describe('public profile bindings', () => {
  it('shares one reader across consumers and preserves leases for the same Blob', async () => {
    const enbox = source();
    const avatar = new Blob(['image']);
    mocks.snapshots.set('did:a', profile('Alice', avatar));
    const one = renderHook(() => useProfile(enbox, 'did:a'));
    const two = renderHook(() => useProfiles(enbox, ['did:b']));
    expect(mocks.createReader).toHaveBeenCalledOnce();
    expect(one.result.current.displayName).toBe('Alice');
    const url = one.result.current.avatarUrl;
    one.rerender();
    expect(one.result.current.avatarUrl).toBe(url);
    expect(mocks.acquire).toHaveBeenCalledOnce();
    mocks.snapshots.set('did:a', profile('Alice', new Blob(['replacement'])));
    act(() => { for (const notify of mocks.watchers) notify(); });
    expect(one.result.current.avatarUrl).not.toBe(url);
    expect(mocks.releaseAfter).toHaveBeenCalledWith(60_000);
    one.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.dispose).not.toHaveBeenCalled();
    two.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('updates late profile settlement and masks a replaced source immediately', () => {
    const first = source(); const second = source();
    const hook = renderHook(({ enbox }) => useProfile(enbox, 'did:a'), { initialProps: { enbox: first } });
    expect(hook.result.current.displayName).toBeUndefined();
    mocks.snapshots.set('did:a', profile('Late name'));
    act(() => { for (const notify of mocks.watchers) notify(); });
    expect(hook.result.current.displayName).toBe('Late name');
    mocks.snapshots.clear();
    hook.rerender({ enbox: second });
    expect(hook.result.current.displayName).toBeUndefined();
  });

  it('keeps reader lifetime through StrictMode replay and reacquires after actual retirement', async () => {
    const enbox = source();
    mocks.snapshots.set('did:a', profile('Alice'));
    const hook = renderHook(() => useProfile(enbox, 'did:a'), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.createReader).toHaveBeenCalledOnce();
    expect(mocks.dispose).not.toHaveBeenCalled();
    hook.unmount();
    await act(async () => { await Promise.resolve(); });
    renderHook(() => useProfile(enbox, 'did:a'));
    expect(mocks.createReader).toHaveBeenCalledTimes(2);
  });

  it('uses no reader for disabled, empty, or absent sources', () => {
    renderHook(() => useProfiles(undefined, ['did:a']));
    renderHook(() => useProfile(source(), 'did:a', false));
    renderHook(() => useProfile(source(), ''));
    renderHook(() => useProfiles(source(), []));
    expect(mocks.createReader).not.toHaveBeenCalled();
  });

  it('does not fetch or lease URLs during construction and ignores a retired watch after reactivation', async () => {
    const observer = new ProfilesObserver(source(), ['did:a']);
    expect(mocks.createReader).not.toHaveBeenCalled();
    const stop = observer.subscribe(() => {});
    const retired = [...mocks.watchers][0]!;
    stop();
    await Promise.resolve();
    const release = observer.subscribe(() => {});
    const before = observer.getSnapshot();
    retired();
    expect(observer.getSnapshot()).toBe(before);
    release();
  });
});
