import { expect, it, vi } from 'vitest';

import { createRecordStore } from '../src/config/index.js';
import { ControlledView } from './helpers.js';

it.each(['record', 'selected'] as const)('bounds %s-store notification when a listener resubscribes', async (kind) => {
  const view = new ControlledView(['initial']);
  const store = kind === 'record' ? createRecordStore(async () => view)
    : createRecordStore({ selection: 'current', open: async () => view });
  let release = (): void => {};
  let armed = false;
  let calls = 0;
  const listener = (): void => {
    if (!armed) return;
    calls += 1;
    // Bound the probe so a live-Set iteration fails instead of hanging the suite.
    if (calls < 3) {
      release();
      release = store.subscribe(listener);
    }
  };
  release = store.subscribe(listener);
  try {
    await store.ready();
    armed = true;
    view.publish({ status: 'ready', current: true, hasMore: false, records: ['first update'] });
    expect(calls).toBe(1);
    view.publish({ status: 'ready', current: true, hasMore: false, records: ['next update'] });
    expect(calls).toBe(2);
  } finally {
    release();
    await store.close();
  }
});

it('does not call a subscription removed earlier in the same dispatch', async () => {
  const view = new ControlledView(['initial']);
  const store = createRecordStore(async () => view);
  let armed = false;
  let releaseSecond = (): void => {};
  const second = vi.fn();
  const releaseFirst = store.subscribe(() => { if (armed) releaseSecond(); });
  releaseSecond = store.subscribe(() => { if (armed) second(); });
  try {
    await store.ready();
    armed = true;
    view.publish({ status: 'ready', current: true, hasMore: false, records: ['changed'] });
    expect(second).not.toHaveBeenCalled();
  } finally {
    releaseFirst();
    releaseSecond();
    await store.close();
  }
});

it('allows a newly added subscriber to receive a separate nested publication', async () => {
  const view = new ControlledView(['initial']);
  const store = createRecordStore(async () => view);
  let armed = false;
  let nested = false;
  let releaseAdded = (): void => {};
  const added = vi.fn();
  const release = store.subscribe(() => {
    if (!armed || nested) return;
    nested = true;
    releaseAdded = store.subscribe(added);
    view.publish({ status: 'ready', current: true, hasMore: false, records: ['nested'] });
  });
  try {
    await store.ready();
    armed = true;
    view.publish({ status: 'ready', current: true, hasMore: false, records: ['outer'] });
    expect(store.getSnapshot().records).toEqual(['nested']);
    expect(added).toHaveBeenCalledOnce();
  } finally {
    release();
    releaseAdded();
    await store.close();
  }
});
