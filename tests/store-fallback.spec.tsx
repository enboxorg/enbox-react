import type { ObservableStore } from '@enbox/browser';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStore } from '../src/index.js';

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
    const hook = renderHook(() => useStore(source));
    act(() => { count = 2; notify(); });
    expect(hook.result.current).toBe(2);
  });

  it('reads published snapshots with the store receiver and releases only its subscription', () => {
    const first = Object.freeze({ count: 1 });
    const second = Object.freeze({ count: 2 });
    const store = new TestStore<Readonly<{ count: number }>>(first);
    const hook = renderHook(() => useStore(store));
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
    const hook = renderHook(({ store, fallback }) => useStore(store, { fallback }), {
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
    const hook = renderHook(() => useStore(store, { fallback: 0 }));
    expect(hook.result.current).toBe(2);
    expect(store.onSubscribe).toHaveBeenCalledOnce();
  });

  it('uses Object.is by default to skip unchanged selected slices', () => {
    const store = new TestStore({ count: 1, status: 'ready' });
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useStore(store, { selector: (snapshot) => snapshot.count });
    });
    const initialRenders = renders;
    act(() => store.publish({ count: 1, status: 'refreshing' }));
    expect(renders).toBe(initialRenders);
    act(() => store.publish({ count: 2, status: 'ready' }));
    expect(hook.result.current).toBe(2);
    expect(renders).toBeGreaterThan(initialRenders);
    hook.unmount();
    expect(store.listeners.size).toBe(0);
    expect(store.close).not.toHaveBeenCalled();
  });

  it('preserves equal object selections and applies selector and source changes immediately', () => {
    const first = new TestStore(2);
    const second = new TestStore(3);
    const fallback = Object.freeze({ value: 0 });
    const hook = renderHook(({ store, multiplier }) => useStore(store, { fallback: fallback, selector: (snapshot) => ({ value: snapshot * multiplier }), isEqual: (previous, next) => previous.value === next.value }), { initialProps: { store: first, multiplier: 1 } });
    const original = hook.result.current;
    hook.rerender({ store: first, multiplier: 1 });
    expect(hook.result.current).toBe(original);
    hook.rerender({ store: first, multiplier: 2 });
    expect(hook.result.current).toEqual({ value: 4 });
    hook.rerender({ store: second, multiplier: 2 });
    expect(hook.result.current).toEqual({ value: 6 });
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
    act(() => second.publish(4));
    expect(hook.result.current).toEqual({ value: 8 });
  });

  it('uses selected fallbacks without passing absent sources to the selector', () => {
    const select = vi.fn((snapshot: number) => `count:${snapshot}`);
    const hook = renderHook(({ store, fallback }) => useStore(store, { fallback: fallback, selector: select }), {
      initialProps: { store: null as TestStore<number> | null | undefined, fallback: 'none' },
    });
    expect(hook.result.current).toBe('none');
    hook.rerender({ store: undefined, fallback: 'updated fallback' });
    expect(hook.result.current).toBe('updated fallback');
    expect(select).not.toHaveBeenCalled();
    hook.rerender({ store: new TestStore(2), fallback: 'none' });
    expect(hook.result.current).toBe('count:2');
  });

  it('reselects mutable sources that have the same revision when their identities change', () => {
    class MutableSource extends TestStore<number> {
      public constructor(public readonly label: string) { super(0); }
    }
    const first = new MutableSource('first');
    const second = new MutableSource('second');
    const hook = renderHook(({ store }) => useStore(store, { fallback: 'none', selector: () => store.label }), {
      initialProps: { store: first },
    });
    expect(hook.result.current).toBe('first');
    hook.rerender({ store: second });
    expect(hook.result.current).toBe('second');
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
  });

  it('selects a legitimate undefined snapshot without substituting the fallback', () => {
    const store = new TestStore<number | undefined>(undefined);
    const hook = renderHook(() => [
      useStore(store, { fallback: 0 }),
      useStore(store, { fallback: 'fallback', selector: (snapshot) => snapshot === undefined ? 'undefined' : String(snapshot) }),
    ]);
    expect(hook.result.current).toEqual([undefined, 'undefined']);
  });

  it('observes selected updates made while the subscription attaches', () => {
    const store = new TestStore(1);
    store.onSubscribe = () => store.publish(2);
    const hook = renderHook(() => useStore(store, { fallback: 'none', selector: (snapshot) => `count:${snapshot}` }));
    expect(hook.result.current).toBe('count:2');
  });
});
