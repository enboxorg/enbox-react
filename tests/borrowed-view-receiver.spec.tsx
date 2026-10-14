import { renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useContextView, useRecords, useRecordView } from '../src/index.js';
import type { ContextViewResult, RecordViewResult } from '../src/index.js';

class Controls {
  public readonly listeners = new Set<() => void>();
  public retries = 0;
  public pages = 0;
  public closes = 0;

  public subscribe(notify: () => void): () => void {
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  }
  public async retry(): Promise<void> { this.retries += 1; }
  public async loadMore(): Promise<void> { this.pages += 1; }
  public async close(): Promise<void> { this.closes += 1; }
}

class Records extends Controls {
  private readonly state: Extract<RecordViewResult<string>, { status: 'ready' }> = Object.freeze({
    status: 'ready', records: ['saved'], current: true, hasMore: false, isLoadingMore: false,
    retry: () => this.retry(),
  });

  public getSnapshot(): RecordViewResult<string> { return this.state; }
  public getServerSnapshot(): RecordViewResult<string> { return this.state; }
  public async ready(): Promise<typeof this.state> { return this.state; }
}

class Contexts extends Controls {
  private readonly state: Extract<ContextViewResult<string>, { status: 'ready' }> = Object.freeze({
    status: 'ready', contexts: ['shared'], retry: () => this.retry(),
  });

  public getSnapshot(): ContextViewResult<string> { return this.state; }
  public getServerSnapshot(): ContextViewResult<string> { return this.state; }
  public async ready(): Promise<typeof this.state> { return this.state; }
}

describe('borrowed view method receivers', () => {
  it('preserves ordinary record store methods in SSR, subscriptions, and controls', async () => {
    const store = new Records();
    function Server() {
      return <p>{useRecordView(store).records.join(',')}</p>;
    }
    expect(renderToString(<Server />)).toContain('saved');
    expect(store.listeners.size).toBe(0);
    const hook = renderHook(() => useRecords(store));
    expect(hook.result.current.records).toEqual(['saved']);
    expect(store.listeners.size).toBe(1);
    const { retry, loadMore } = hook.result.current;
    await retry();
    await loadMore();
    expect(store.retries).toBe(1);
    expect(store.pages).toBe(1);
    hook.rerender();
    expect(hook.result.current.retry).toBe(retry);
    expect(hook.result.current.loadMore).toBe(loadMore);
    hook.unmount();
    expect(store.listeners.size).toBe(0);
    expect(store.closes).toBe(0);
  });

  it('preserves ordinary context store methods in SSR, subscriptions, and controls', async () => {
    const store = new Contexts();
    function Server() {
      return <p>{useContextView(store).contexts.join(',')}</p>;
    }
    expect(renderToString(<Server />)).toContain('shared');
    expect(store.listeners.size).toBe(0);
    const hook = renderHook(() => useContextView(store));
    expect(hook.result.current.contexts).toEqual(['shared']);
    expect(store.listeners.size).toBe(1);
    const retry = hook.result.current.retry;
    await retry();
    expect(store.retries).toBe(1);
    hook.rerender();
    expect(hook.result.current.retry).toBe(retry);
    hook.unmount();
    expect(store.listeners.size).toBe(0);
    expect(store.closes).toBe(0);
  });
});
