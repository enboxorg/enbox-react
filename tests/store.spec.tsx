import { act, render, renderHook } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useStore } from '../src/hooks/store.js';

type Snapshot = Readonly<{ records: readonly string[]; current: boolean }>;

class Resource {
  public snapshot: Snapshot = Object.freeze({ records: ['saved'], current: true });
  public readonly listeners = new Set<(snapshot: Snapshot) => void>();
  public readonly retain = vi.fn(() => () => {});
  public readonly close = vi.fn(async () => {});

  public getSnapshot(): Snapshot { return this.snapshot; }
  public subscribe(notify: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  }
  public publish(snapshot: Snapshot): void {
    this.snapshot = Object.freeze(snapshot);
    for (const notify of this.listeners) notify(this.snapshot);
  }
}

describe('application store subscriptions', () => {
  it('shares a resource and releases each committed consumer independently', () => {
    const resource = new Resource();
    const first = renderHook(() => useStore(resource));
    const second = renderHook(() => useStore(resource));
    expect(first.result.current).toBe(resource.getSnapshot());
    expect(second.result.current).toBe(first.result.current);
    expect(resource.retain).not.toHaveBeenCalled();
    act(() => resource.publish({ records: ['changed'], current: true }));
    expect(first.result.current.records).toEqual(['changed']);
    expect(second.result.current).toBe(first.result.current);
    first.unmount();
    expect(resource.listeners.size).toBe(1);
    second.unmount();
    expect(resource.listeners.size).toBe(0);
    expect(resource.close).not.toHaveBeenCalled();
  });

  it('selects a slice without rerendering for unrelated publications', () => {
    const resource = new Resource();
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useStore(resource, { selector: (snapshot) => snapshot.records.length });
    });
    const initialRenders = renders;
    act(() => resource.publish({ records: ['saved'], current: false }));
    expect(renders).toBe(initialRenders);
    act(() => resource.publish({ records: ['saved', 'new'], current: false }));
    expect(hook.result.current).toBe(2);
    expect(renders).toBe(initialRenders + 1);
    hook.unmount();
  });

  it('supports custom selector equality and ordinary method receivers', () => {
    const resource = new Resource();
    const hook = renderHook(() => useStore(resource, {
      selector: (snapshot) => ({ count: snapshot.records.length }),
      isEqual: (previous, next) => previous.count === next.count,
    }));
    const selected = hook.result.current;
    act(() => resource.publish({ records: ['renamed'], current: false }));
    expect(hook.result.current).toBe(selected);
    hook.unmount();
  });

  it('borrows one subscription through StrictMode replay', () => {
    const resource = new Resource();
    const hook = renderHook(() => useStore(resource), { reactStrictMode: true });
    expect(resource.listeners.size).toBe(1);
    hook.unmount();
    expect(resource.listeners.size).toBe(0);
  });

  it('does not acquire resources from an abandoned render', () => {
    const resource = new Resource();
    const pending = new Promise<never>(() => {});
    function Hidden(): never {
      useStore(resource);
      throw pending;
    }
    const tree = render(<Suspense fallback={<p>Waiting</p>}><Hidden /></Suspense>);
    expect(resource.listeners.size).toBe(0);
    tree.unmount();
  });
});
