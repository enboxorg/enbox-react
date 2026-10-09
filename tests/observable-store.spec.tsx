import type { ObservableStore } from '@enbox/browser';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useObservableStore } from '../src/index.js';

class TestStore<Snapshot> implements ObservableStore<Snapshot> {
  public readonly listeners = new Set<(snapshot: Snapshot) => void>();
  public readonly close = vi.fn();
  public onSubscribe: (() => void) | undefined;

  public constructor(private _snapshot: Snapshot) {}

  public getSnapshot(): Snapshot {
    return this._snapshot;
  }

  public subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.onSubscribe?.();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  public publish(snapshot: Snapshot): void {
    this._snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

describe('borrowed observable stores', () => {
  it('borrows stores that publish wake hints without snapshot payloads', () => {
    let count = 1;
    let notify = (): void => {};
    const source = {
      getSnapshot: () => count,
      subscribe: (onChange: () => void) => {
        notify = onChange;
        return () => {};
      },
    };
    const hook = renderHook(() => useObservableStore(source, 0));
    act(() => { count = 2; notify(); });
    expect(hook.result.current).toBe(2);
  });

  it('reads published snapshots with the store receiver and releases only its subscription', () => {
    const first = Object.freeze({ count: 1 });
    const second = Object.freeze({ count: 2 });
    const fallback = Object.freeze({ count: 0 });
    const store = new TestStore<Readonly<{ count: number }>>(first);
    const hook = renderHook(() => useObservableStore(store, fallback));
    expect(hook.result.current).toBe(first);
    hook.rerender();
    expect(hook.result.current).toBe(first);
    expect(store.listeners.size).toBe(1);
    act(() => store.publish(second));
    expect(hook.result.current).toBe(second);
    hook.unmount();
    expect(store.listeners.size).toBe(0);
    expect(store.close).not.toHaveBeenCalled();
  });

  it('releases replaced stores and uses the current fallback when no store is supplied', () => {
    const first = new TestStore(1);
    const second = new TestStore(2);
    const hook = renderHook(({ store, fallback }) => useObservableStore(store, fallback), {
      initialProps: { store: first as ObservableStore<number> | null | undefined, fallback: 0 },
    });
    hook.rerender({ store: second, fallback: 0 });
    expect(hook.result.current).toBe(2);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
    hook.rerender({ store: null, fallback: 3 });
    expect(hook.result.current).toBe(3);
    expect(second.listeners.size).toBe(0);
    hook.rerender({ store: undefined, fallback: 4 });
    expect(hook.result.current).toBe(4);
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  it('does not lose a change made while its subscription attaches', () => {
    const store = new TestStore(1);
    store.onSubscribe = vi.fn(() => store.publish(2));
    const hook = renderHook(() => useObservableStore(store, 0));
    expect(hook.result.current).toBe(2);
    expect(store.onSubscribe).toHaveBeenCalledOnce();
  });
});
