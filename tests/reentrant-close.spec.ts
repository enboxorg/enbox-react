import type { RecordStore } from '../src/config/record-store.js';

import { expect, it, vi } from 'vitest';

import { EnboxBindingChangedError } from '../src/errors.js';
import { createRecordStore } from '../src/config/index.js';
import { ControlledView, deferred } from './helpers.js';

it.each([
  { kind: 'record', stage: 'unsubscribe' }, { kind: 'record', stage: 'abort' }, { kind: 'record', stage: 'close' },
  { kind: 'selected', stage: 'unsubscribe' }, { kind: 'selected', stage: 'abort' }, { kind: 'selected', stage: 'close' },
] as const)('tracks the $kind view before $stage can close its owner', async ({ kind, stage }) => {
  const nativeClose = deferred<void>();
  const view = new ControlledView(['saved']);
  let store!: RecordStore<string>;
  let reentrant!: Promise<void>;
  view.close.mockImplementation(() => {
    if (stage === 'close') reentrant = store.close();
    return nativeClose.promise;
  });
  const subscribe = view.subscribe;
  vi.spyOn(view, 'subscribe').mockImplementation((notify) => {
    const release = subscribe(notify);
    return () => {
      release();
      if (stage === 'unsubscribe') reentrant = store.close();
    };
  });
  const open = async (signal: AbortSignal): Promise<ControlledView<string>> => {
    if (stage === 'abort') signal.addEventListener('abort', () => { reentrant = store.close(); }, { once: true });
    return view;
  };
  store = kind === 'record' ? createRecordStore(open)
    : createRecordStore({ selection: 'current', open: (_selection, signal) => open(signal) });
  try {
    await store.ready();
    await store.retry().catch((error: unknown) => {
      expect(error).toBeInstanceOf(EnboxBindingChangedError);
    });
    let finished = false;
    void reentrant.then(() => { finished = true; });
    await Promise.resolve();
    expect(view.close).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    nativeClose.resolve();
    await reentrant;
    expect(finished).toBe(true);
  } finally {
    nativeClose.resolve();
    await store.close();
  }
});
