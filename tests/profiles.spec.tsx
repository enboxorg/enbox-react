import type { ProfileReaderSource, ProfileSnapshot } from '@enbox/browser';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const snapshots = new Map<string, unknown>();
  const offSnapshots = new WeakMap<ProfileSnapshot, ProfileSnapshot>();
  const watchers = new Set<() => void>();
  const dispose = vi.fn();
  const watch = vi.fn((dids: readonly string[], notify: () => void) => {
    watchers.add(notify);
    for (const _did of dids) notify();
    return () => { watchers.delete(notify); };
  });
  const getSnapshot = vi.fn((did: string, policy: 'off' | 'eager') => {
    const snapshot = snapshots.get(did) as ProfileSnapshot | undefined;
    if (snapshot === undefined || policy !== 'off') return snapshot;
    let off = offSnapshots.get(snapshot);
    if (off === undefined) {
      off = { ...snapshot, status: snapshot.profile.status === 'idle' ? 'loading' : snapshot.profile.status,
        avatar: { status: 'idle' }, hero: { status: 'idle' },
      };
      offSnapshots.set(snapshot, off);
    }
    return off;
  });
  const loadImages = vi.fn(async (_did: string) => ({}));
  const createReader = vi.fn((_source: ProfileReaderSource, options: { images: 'off' | 'eager' }) => ({
    watch, getSnapshot: (did: string) => getSnapshot(did, options.images), loadImages, dispose,
  }));
  let nextUrl = 0;
  const releaseAfter = vi.fn();
  const acquire = vi.fn(() => ({ url: `blob:test-${nextUrl++}`, release: vi.fn(), releaseAfter }));
  return { snapshots, watchers, dispose, watch, getSnapshot, loadImages, createReader, acquire, releaseAfter };
});
vi.mock('@enbox/browser', async (original) => ({
  ...await original<typeof import('@enbox/browser')>(),
  createProfileReader: mocks.createReader,
  createBlobUrlPool: () => ({ acquire: mocks.acquire, dispose: vi.fn() }),
}));
import { useProfile, useProfiles } from '../src/hooks/profiles.js';
import { ProfilesObserver } from '../src/internal/profiles-observer.js';
import { EnboxBindingChangedError } from '../src/internal/errors.js';
import { deferred } from './helpers.js';

function source(): ProfileReaderSource { return { records: {} } as ProfileReaderSource; }
function profile(name: string, avatar?: Blob) {
  return { status: 'settled', profile: { status: 'settled', value: { displayName: name } },
    avatar: { status: avatar === undefined ? 'idle' : 'settled', value: avatar }, hero: { status: 'idle' },
  };
}
beforeEach(() => {
  mocks.snapshots.clear(); mocks.watchers.clear(); vi.clearAllMocks();
  mocks.loadImages.mockReset().mockResolvedValue({});
});

describe('public profile bindings', () => {
  it('exposes native settlement and field failures without discarding usable text', () => {
    const enbox = source();
    const cause = new Error('invalid image');
    const failure = { retryable: false, code: 400, message: 'invalid image', cause };
    mocks.snapshots.set('did:a', {
      did: 'did:a', status: 'settled',
      profile: { status: 'settled', value: { displayName: 'Alice' } },
      avatar: { status: 'error', failure }, hero: { status: 'not-found' },
    });
    const hook = renderHook(() => useProfile(enbox, 'did:a'));
    expect(hook.result.current).toMatchObject({
      did: 'did:a', status: 'settled', displayName: 'Alice',
      fields: { profile: { status: 'settled' }, avatar: { status: 'error', failure }, hero: { status: 'not-found' } },
    });
    expect(hook.result.current.fields.avatar.failure?.cause).toBe(cause);
    mocks.snapshots.set('did:a', {
      did: 'did:a', status: 'error', profile: { status: 'error', failure },
      avatar: { status: 'idle' }, hero: { status: 'idle' },
    });
    act(() => { for (const notify of mocks.watchers) notify(); });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.fields.profile.failure).toBe(failure);
    mocks.snapshots.set('did:a', {
      did: 'did:a', status: 'not-found', profile: { status: 'not-found' },
      avatar: { status: 'not-found' }, hero: { status: 'not-found' },
    });
    act(() => { for (const notify of mocks.watchers) notify(); });
    expect(hook.result.current.status).toBe('not-found');
    expect(hook.result.current.displayName).toBeUndefined();
  });

  it('returns inert idle state for missing or disabled sources and absent DIDs', async () => {
    const missing = renderHook(() => useProfile(undefined, 'did:a'));
    const disabled = renderHook(() => useProfile(source(), 'did:a', { enabled: false }));
    const absent = renderHook(() => useProfile(source(), undefined));
    const states = renderHook(() => useProfiles(source(), ['did:a', 'did:b'], { enabled: false }));
    expect(missing.result.current.status).toBe('idle');
    expect(disabled.result.current.status).toBe('idle');
    expect(absent.result.current.did).toBeUndefined();
    expect(absent.result.current.status).toBe('idle');
    expect(states.result.current.get('did:b')?.status).toBe('idle');
    expect(mocks.createReader).not.toHaveBeenCalled();
    await expect(missing.result.current.loadImages()).rejects.toBeInstanceOf(EnboxBindingChangedError);
  });

  it('shares eager reads while text-only observers keep their own native metadata and avoid image leases', async () => {
    const enbox = source();
    const text = { status: 'settled', value: { displayName: 'Alice' } };
    mocks.snapshots.set('did:a', {
      did: 'did:a', status: 'loading', profile: text,
      avatar: { status: 'loading' }, hero: { status: 'loading' },
    });
    const eager = renderHook(() => useProfile(enbox, 'did:a'));
    const second = renderHook(() => useProfile(enbox, 'did:a'));
    const off = renderHook(() => useProfile(enbox, 'did:a', { images: 'off' }));
    expect(mocks.loadImages).not.toHaveBeenCalled();
    expect(mocks.createReader).toHaveBeenCalledTimes(2);
    expect(mocks.createReader).toHaveBeenCalledWith(enbox, { images: 'eager' });
    expect(mocks.createReader).toHaveBeenCalledWith(enbox, { images: 'off' });
    expect(eager.result.current.status).toBe('loading');
    expect(off.result.current.status).toBe('settled');
    expect(off.result.current.fields.avatar.status).toBe('idle');

    mocks.snapshots.set('did:a', {
      did: 'did:a', status: 'settled', profile: text,
      avatar: { status: 'settled', value: new Blob(['avatar']) },
      hero: { status: 'settled', value: new Blob(['hero']) },
    });
    act(() => { for (const notify of mocks.watchers) notify(); });
    expect(eager.result.current.avatarUrl).toBeDefined();
    expect(second.result.current.avatarUrl).toBeDefined();
    expect(off.result.current.avatarUrl).toBeUndefined();
    expect(off.result.current.heroUrl).toBeUndefined();
    // Each of the two image consumers owns one lease per image; off owns none.
    expect(mocks.acquire).toHaveBeenCalledTimes(4);
    await expect(off.result.current.loadImages()).rejects.toThrow('disabled');
  });

  it('waits for explicit image loading in lazy mode and accepts stable inline options', async () => {
    const enbox = source();
    mocks.snapshots.set('did:a', {
      did: 'did:a', status: 'settled',
      profile: { status: 'settled', value: { displayName: 'Alice' } },
      avatar: { status: 'settled', value: new Blob(['cached image']) }, hero: { status: 'idle' },
    });
    const hook = renderHook(() => useProfile(enbox, 'did:a', { images: 'lazy' }));
    const initial = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(initial);
    expect(mocks.watch).toHaveBeenCalledOnce();
    expect(mocks.loadImages).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(initial.avatarUrl).toBeUndefined();
    await act(async () => { await initial.loadImages(); });
    expect(mocks.loadImages).toHaveBeenCalledWith('did:a');
    expect(hook.result.current.avatarUrl).toBeDefined();
    expect(mocks.acquire).toHaveBeenCalledOnce();
    await act(async () => { await hook.result.current.loadImages(); });
    expect(mocks.acquire).toHaveBeenCalledOnce();
  });

  it('keeps a loading result stable when lazy demand still has no native snapshot', async () => {
    const enbox = source();
    const hook = renderHook(() => useProfile(enbox, 'did:a', { images: 'lazy' }));
    const initial = hook.result.current;
    expect(initial.status).toBe('loading');
    await act(async () => { await initial.loadImages(); });
    expect(hook.result.current).toBe(initial);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it('reserves lazy demand before image watch attachment can reenter the same control', async () => {
    mocks.snapshots.set('did:a', profile('Alice', new Blob(['avatar'])));
    const observer = new ProfilesObserver(source(), ['did:a'], 'lazy');
    const release = observer.subscribe(() => {});
    const stopImageWatch = vi.fn();
    let reentered!: Promise<void>;
    mocks.watch.mockImplementationOnce((_dids, notify) => {
      reentered = observer.getSnapshot().get('did:a')!.loadImages();
      notify();
      return stopImageWatch;
    });
    try {
      await Promise.all([observer.getSnapshot().get('did:a')!.loadImages(), reentered]);
      expect(mocks.watch).toHaveBeenCalledTimes(2);
      expect(observer.getSnapshot().get('did:a')?.avatarUrl).toBeDefined();
      expect(mocks.acquire).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    expect(stopImageWatch).toHaveBeenCalledOnce();
  });

  it('releases failed lazy watch demand and allows the same control to retry', async () => {
    mocks.snapshots.set('did:a', profile('Alice', new Blob(['avatar'])));
    const observer = new ProfilesObserver(source(), ['did:a'], 'lazy');
    const release = observer.subscribe(() => {});
    const loadImages = observer.getSnapshot().get('did:a')!.loadImages;
    const failure = new Error('image watch failed');
    mocks.watch.mockImplementationOnce(() => { throw failure; });
    try {
      await expect(loadImages()).rejects.toBe(failure);
      expect(observer.getSnapshot().get('did:a')?.fields.avatar.status).toBe('idle');
      expect(mocks.loadImages).not.toHaveBeenCalled();
      expect(mocks.acquire).not.toHaveBeenCalled();
      expect(mocks.dispose).toHaveBeenCalledOnce();
      await loadImages();
      expect(observer.getSnapshot().get('did:a')?.avatarUrl).toBeDefined();
      expect(mocks.createReader).toHaveBeenCalledTimes(3);
    } finally {
      release();
    }
  });

  it('fences replaced and reactivated image controls while preserving issued rejections', async () => {
    const first = source(); const second = source();
    mocks.snapshots.set('did:a', profile('Alice'));
    const hook = renderHook(({ enbox }) => useProfile(enbox, 'did:a', { images: 'lazy' }), {
      initialProps: { enbox: first },
    });
    const retired = hook.result.current.loadImages;
    hook.rerender({ enbox: second });
    await expect(retired()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    expect(mocks.loadImages).not.toHaveBeenCalled();
    const pending = deferred<{}>();
    mocks.loadImages.mockReturnValueOnce(pending.promise);
    let issued!: Promise<void>;
    act(() => { issued = hook.result.current.loadImages(); });
    const failure = new Error('native image request failed');
    const rejection = expect(issued).rejects.toBe(failure);
    await Promise.resolve();
    hook.unmount();
    pending.reject(failure);
    await rejection;

    const observer = new ProfilesObserver(source(), ['did:a'], 'lazy');
    const stop = observer.subscribe(() => {});
    const oldControl = observer.getSnapshot().get('did:a')!.loadImages;
    stop();
    const release = observer.subscribe(() => {});
    await expect(oldControl()).rejects.toBeInstanceOf(EnboxBindingChangedError);
    release();
  });

  it('preserves unaffected state references and publishes field-only changes', () => {
    const alice = profile('Alice');
    mocks.snapshots.set('did:a', alice);
    mocks.snapshots.set('did:b', profile('Bob'));
    const observer = new ProfilesObserver(source(), ['did:a', 'did:b'], 'eager');
    const notify = vi.fn();
    const stop = observer.subscribe(notify);
    try {
      const initial = observer.getSnapshot();
      mocks.snapshots.set('did:a', { ...alice, hero: { status: 'not-found' } });
      for (const emit of mocks.watchers) emit();
      const changed = observer.getSnapshot();
      expect(changed).not.toBe(initial);
      expect(changed.get('did:b')).toBe(initial.get('did:b'));
      expect(changed.get('did:a')!.displayName).toBe(initial.get('did:a')!.displayName);
      expect(changed.get('did:a')!.loadImages).toBe(initial.get('did:a')!.loadImages);
      expect(changed.get('did:a')!.fields.hero.status).toBe('not-found');
      for (const emit of mocks.watchers) emit();
      expect(observer.getSnapshot()).toBe(changed);
      expect(notify).toHaveBeenCalledTimes(2);
    } finally { stop(); }
  });

  it('batches synchronous initial watch emissions and skips unchanged publications', () => {
    const avatar = new Blob(['image']);
    mocks.snapshots.set('did:a', profile('Alice', avatar));
    mocks.snapshots.set('did:b', profile('Bob'));
    const observer = new ProfilesObserver(source(), ['did:a', 'did:b', 'did:c']);
    const notify = vi.fn();
    const stop = observer.subscribe(notify);
    try {
      const initial = observer.getSnapshot();
      expect(mocks.getSnapshot).toHaveBeenCalledTimes(3);
      expect(notify).toHaveBeenCalledOnce();
      expect(initial.get('did:c')).toMatchObject({ did: 'did:c', status: 'loading' });
      expect(initial.get('did:c')?.displayName).toBeUndefined();
      for (const emit of mocks.watchers) emit();
      expect(observer.getSnapshot()).toBe(initial);
      expect(notify).toHaveBeenCalledOnce();
      expect(mocks.acquire).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

  it('preserves unaffected profiles and leases when one DID changes or disappears', () => {
    const avatar = new Blob(['image']);
    mocks.snapshots.set('did:a', profile('Alice', avatar));
    mocks.snapshots.set('did:b', profile('Bob'));
    const observer = new ProfilesObserver(source(), ['did:a', 'did:b', 'did:c']);
    const stop = observer.subscribe(() => {});
    try {
      const initial = observer.getSnapshot();
      mocks.snapshots.set('did:a', profile('Alicia', avatar));
      for (const emit of mocks.watchers) emit();
      const changed = observer.getSnapshot();
      expect(changed).not.toBe(initial);
      expect(changed.get('did:a')?.displayName).toBe('Alicia');
      expect(changed.get('did:b')).toBe(initial.get('did:b'));
      expect(changed.get('did:c')).toBe(initial.get('did:c'));
      expect(changed.get('did:a')?.avatarUrl).toBe(initial.get('did:a')?.avatarUrl);
      expect(mocks.acquire).toHaveBeenCalledOnce();
      expect(mocks.releaseAfter).not.toHaveBeenCalled();

      mocks.snapshots.delete('did:a');
      for (const emit of mocks.watchers) emit();
      expect(observer.getSnapshot().get('did:a')?.displayName).toBeUndefined();
      expect(observer.getSnapshot().get('did:a')?.avatarUrl).toBeUndefined();
      expect(observer.getSnapshot().get('did:b')).toBe(initial.get('did:b'));
      expect(mocks.releaseAfter).toHaveBeenCalledWith(60_000);
    } finally {
      stop();
    }
  });

  it('publishes settlement metadata while retaining image URLs and unaffected profiles', () => {
    const alice = profile('Alice', new Blob(['image']));
    mocks.snapshots.set('did:a', alice);
    mocks.snapshots.set('did:b', profile('Bob'));
    const observer = new ProfilesObserver(source(), ['did:a', 'did:b']);
    const notify = vi.fn();
    const stop = observer.subscribe(notify);
    try {
      const initial = observer.getSnapshot();
      mocks.snapshots.set('did:a', { ...alice, hero: { status: 'not-found' } });
      for (const emit of mocks.watchers) emit();
      const changed = observer.getSnapshot();
      expect(changed).not.toBe(initial);
      expect(changed.get('did:a')).not.toBe(initial.get('did:a'));
      expect(changed.get('did:a')!.avatarUrl).toBe(initial.get('did:a')!.avatarUrl);
      expect(changed.get('did:a')!.fields.hero.status).toBe('not-found');
      expect(changed.get('did:b')).toBe(initial.get('did:b'));
      expect(notify).toHaveBeenCalledTimes(2);
      expect(mocks.acquire).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

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

  it('keeps a replacement watch and image lease acquired during native cleanup', async () => {
    const observer = new ProfilesObserver(source(), ['did:a']);
    mocks.snapshots.set('did:a', profile('Alice', new Blob(['avatar'])));
    let releaseReplacement = (): void => {};
    mocks.watch.mockImplementationOnce((_dids, notify) => {
      mocks.watchers.add(notify);
      return () => {
        mocks.watchers.delete(notify);
        releaseReplacement = observer.subscribe(() => {});
      };
    });
    const release = observer.subscribe(() => {});
    const oldLoad = observer.getSnapshot().get('did:a')!.loadImages;
    try {
      release();
      expect(observer.getSnapshot().get('did:a')?.displayName).toBe('Alice');
      expect(mocks.watchers.size).toBe(1);
      expect(mocks.acquire).toHaveBeenCalledTimes(2);
      expect(mocks.releaseAfter).toHaveBeenCalledTimes(1);
      await expect(oldLoad()).rejects.toBeInstanceOf(EnboxBindingChangedError);
      await observer.getSnapshot().get('did:a')!.loadImages();
    } finally {
      releaseReplacement();
      await Promise.resolve();
    }
    expect(mocks.watchers.size).toBe(0);
    expect(mocks.releaseAfter).toHaveBeenCalledTimes(2);
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
    renderHook(() => useProfile(source(), 'did:a', { enabled: false }));
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
