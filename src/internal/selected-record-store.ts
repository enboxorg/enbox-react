import type { RecordView } from '@enbox/browser';

import type { RecordStore, RecordStoreOptions } from '../config/record-store.js';
import { EnboxBindingChangedError } from '../errors.js';
import { reportCleanupError } from './errors.js';
import { RecordViewObserver, type RecordViewResult } from './record-view-observer.js';

export type SelectedRecordSnapshot<Item, Selection> = RecordViewResult<Item> & Readonly<{
  selection: Selection | null;
}>;

export type SelectedRecordStoreConfig<Item, Selection> = RecordStoreOptions & Readonly<{
  selection: Selection | null;
  open(selection: Selection, signal: AbortSignal): Promise<RecordView<Item>>;
}>;

export type SelectedRecordStore<Item, Selection> = Omit<RecordStore<Item>, 'getSnapshot' | 'getServerSnapshot' | 'ready'> & Readonly<{
  getSnapshot(): SelectedRecordSnapshot<Item, Selection>;
  getServerSnapshot(): SelectedRecordSnapshot<Item, Selection>;
  ready(options?: { signal?: AbortSignal }): Promise<Extract<SelectedRecordSnapshot<Item, Selection>, { status: 'ready' }>>;
  /** Replace the selection and resolve after its native view attaches. Null releases it. */
  select(selection: Selection | null): Promise<void>;
  /** Display-only rows, replaced by the next native publication. */
  updateRecords(update: (records: readonly Item[]) => readonly Item[]): void;
}>;

type Slot<Item, Selection> = {
  selection: Selection | null;
  observer: RecordViewObserver<Item>;
  snapshot: RecordViewResult<Item>;
  server: SelectedRecordSnapshot<Item, Selection>;
  opening?: Promise<void>;
  nativeOpening?: Promise<void>;
  stop?: () => void;
};

/** A stable owner; native lifetime and pagination remain in RecordViewObserver. */
export class SelectedRecords<Item, Selection> implements SelectedRecordStore<Item, Selection> {
  private readonly listeners = new Set<() => void>();
  private readonly closing = new Set<Promise<void>>();
  private readonly idle: SelectedRecordSnapshot<Item, Selection>;
  private slot: Slot<Item, Selection>;
  private snapshot: SelectedRecordSnapshot<Item, Selection>;
  private closed = false;

  public constructor(private readonly config: SelectedRecordStoreConfig<Item, Selection>) {
    this.slot = this.createSlot(config.selection);
    this.snapshot = this.project(this.slot);
    this.idle = Object.freeze({ ...new RecordViewObserver<Item>(null).getSnapshot(), selection: null });
    config.signal?.addEventListener('abort', this.onAbort, { once: true });
    if (config.signal?.aborted) void this.close();
  }

  public readonly getSnapshot = (): SelectedRecordSnapshot<Item, Selection> =>
    this.closed || this.config.signal?.aborted ? this.idle : this.snapshot;

  public readonly getServerSnapshot = (): SelectedRecordSnapshot<Item, Selection> =>
    this.closed || this.config.signal?.aborted ? this.idle : this.slot.server;

  public readonly subscribe = (notify: () => void): (() => void) => {
    if (!this.isOpen()) return () => {};
    const listener = (): void => { notify(); };
    this.listeners.add(listener);
    void this.activate(this.slot).catch(() => {});
    return () => { this.listeners.delete(listener); };
  };

  public readonly select = (selection: Selection | null): Promise<void> => {
    if (!this.isOpen()) return Promise.reject(new EnboxBindingChangedError());
    if (Object.is(this.slot.selection, selection)) return this.activate(this.slot);
    const previous = this.slot;
    const slot = this.createSlot(selection);
    this.slot = slot;
    this.snapshot = this.project(slot);
    this.release(previous);
    if (this.slot !== slot || !this.isOpen()) return Promise.reject(new EnboxBindingChangedError());
    this.notify();
    return this.activate(slot);
  };

  public readonly ready = (options: { signal?: AbortSignal } = {}): Promise<
    Extract<SelectedRecordSnapshot<Item, Selection>, { status: 'ready' }>
  > => {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new EnboxBindingChangedError());
    const slot = this.slot;
    if (!this.isOpen() || slot.selection === null) return Promise.reject(new EnboxBindingChangedError());
    void this.activate(slot).catch(() => {});
    return slot.observer.ready(options).then((state) => {
      if (this.slot !== slot || !this.isOpen()) throw new EnboxBindingChangedError();
      return (slot.snapshot === state ? this.snapshot : this.project(slot, state)) as
        Extract<SelectedRecordSnapshot<Item, Selection>, { status: 'ready' }>;
    });
  };

  public readonly retry = (): Promise<void> => this.retrySlot(this.slot);
  public readonly loadMore = (): Promise<void> => {
    if (!this.isOpen()) return Promise.reject(new EnboxBindingChangedError());
    return this.slot.observer.loadMore();
  };
  public readonly updateRecords = (update: (records: readonly Item[]) => readonly Item[]): void => {
    if (!this.isOpen() || this.slot.selection === null) throw new EnboxBindingChangedError();
    void this.activate(this.slot).catch(() => {});
    this.slot.observer.updateRecords(update);
  };

  public readonly close = async (): Promise<void> => {
    if (!this.closed) {
      this.closed = true;
      this.config.signal?.removeEventListener('abort', this.onAbort);
      this.snapshot = this.idle;
      this.release(this.slot);
      this.notify();
      this.listeners.clear();
    }
    await Promise.all(this.closing);
  };

  private readonly onAbort = (): void => { void this.close(); };
  private isOpen(): boolean { return !this.closed && this.config.signal?.aborted !== true; }

  private createSlot(selection: Selection | null): Slot<Item, Selection> {
    const observer = new RecordViewObserver<Item>(selection === null ? null
      : (signal) => this.config.open(selection, signal), undefined, true, this.config.loadAll === true);
    const slot: Slot<Item, Selection> = {
      selection, observer, snapshot: observer.getSnapshot(),
      server: Object.freeze({ ...observer.getServerSnapshot(), selection }),
    };
    slot.server = Object.freeze({ ...slot.server, retry: () => this.retrySlot(slot) });
    return slot;
  }

  private project(slot: Slot<Item, Selection>, state = slot.snapshot): SelectedRecordSnapshot<Item, Selection> {
    return Object.freeze({ ...state, selection: slot.selection, retry: slot.server.retry });
  }

  private activate(slot: Slot<Item, Selection>): Promise<void> {
    if (!this.isOpen() || this.slot !== slot) return Promise.reject(new EnboxBindingChangedError());
    if (slot.selection === null) return Promise.resolve();
    if (slot.opening !== undefined) return slot.opening;
    const stop = slot.observer.subscribe(() => {
      if (!this.isOpen() || this.slot !== slot) return;
      const snapshot = slot.observer.getSnapshot();
      if (slot.snapshot === snapshot) return;
      slot.snapshot = snapshot;
      this.snapshot = this.project(slot);
      this.notify();
    });
    if (!this.isOpen() || this.slot !== slot) {
      stop();
      return Promise.reject(new EnboxBindingChangedError());
    }
    slot.stop = stop;
    return this.checkedOpening(slot, slot.observer.retry());
  }

  private retrySlot(slot: Slot<Item, Selection>): Promise<void> {
    if (!this.isOpen() || this.slot !== slot || slot.selection === null) return Promise.reject(new EnboxBindingChangedError());
    if (slot.opening === undefined) return this.activate(slot);
    return this.checkedOpening(slot, slot.observer.retry());
  }

  private checkedOpening(slot: Slot<Item, Selection>, nativeOpening: Promise<void>): Promise<void> {
    if (slot.nativeOpening === nativeOpening && slot.opening !== undefined) return slot.opening;
    slot.nativeOpening = nativeOpening;
    slot.opening = nativeOpening.then(() => {
      if (!this.isOpen() || this.slot !== slot) throw new EnboxBindingChangedError();
    });
    void slot.opening.catch(() => {});
    return slot.opening;
  }

  private release(slot: Slot<Item, Selection>): void {
    const stop = slot.stop;
    delete slot.stop;
    stop?.();
    let finish!: () => void;
    const closing = new Promise<void>((resolve) => { finish = resolve; });
    this.closing.add(closing);
    const complete = (): void => { this.closing.delete(closing); finish(); };
    void slot.observer.close().catch(reportCleanupError).then(complete);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) if (this.listeners.has(listener)) listener();
  }
}
