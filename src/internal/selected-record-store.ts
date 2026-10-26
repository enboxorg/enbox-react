import type { RecordView } from '@enbox/browser';

import type { RecordStore, RecordStoreOptions } from '../config/record-store.js';
import { notifyListeners } from './listeners.js';
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
  /** Wait for local rows; reject if this selection is replaced while waiting. */
  ready(options?: { signal?: AbortSignal }): Promise<Extract<SelectedRecordSnapshot<Item, Selection>, { status: 'ready' }>>;
  /** Replace the selection and resolve after its native view attaches. Null releases it. */
  select(selection: Selection | null): Promise<void>;
  /** Display-only rows, replaced by the next native publication. */
  updateRecords(update: (records: readonly Item[]) => readonly Item[]): void;
}>;

type SelectionSlot<Item, Selection> = {
  selection: Selection | null;
  observer: RecordViewObserver<Item>;
  viewSnapshot: RecordViewResult<Item>;
  serverSnapshot: SelectedRecordSnapshot<Item, Selection>;
  opening?: Promise<void>;
  observerOpening?: Promise<void>;
  unsubscribe?: () => void;
};

/** A stable owner; native lifetime and pagination remain in RecordViewObserver. */
export class SelectedRecords<Item, Selection> implements SelectedRecordStore<Item, Selection> {
  private readonly listeners = new Set<() => void>();
  private readonly closingObservers = new Set<RecordViewObserver<Item>>();
  private readonly idle: SelectedRecordSnapshot<Item, Selection>;
  private currentSlot: SelectionSlot<Item, Selection>;
  private snapshot: SelectedRecordSnapshot<Item, Selection>;
  private closed = false;

  public constructor(private readonly config: SelectedRecordStoreConfig<Item, Selection>) {
    this.currentSlot = this.createSlot(config.selection);
    this.snapshot = this.createSnapshot(this.currentSlot);
    this.idle = Object.freeze({ ...new RecordViewObserver<Item>(null).getSnapshot(), selection: null });
    config.signal?.addEventListener('abort', this.onAbort, { once: true });
    if (config.signal?.aborted) void this.close();
  }

  public readonly getSnapshot = (): SelectedRecordSnapshot<Item, Selection> =>
    this.closed || this.config.signal?.aborted ? this.idle : this.snapshot;

  public readonly getServerSnapshot = (): SelectedRecordSnapshot<Item, Selection> =>
    this.closed || this.config.signal?.aborted ? this.idle : this.currentSlot.serverSnapshot;

  public readonly subscribe = (notify: () => void): (() => void) => {
    if (!this.isOpen()) return () => {};
    const listener = (): void => { notify(); };
    this.listeners.add(listener);
    void this.activate(this.currentSlot).catch(() => {});
    return () => { this.listeners.delete(listener); };
  };

  public readonly select = (selection: Selection | null): Promise<void> => {
    if (!this.isOpen()) return Promise.reject(new EnboxBindingChangedError());
    if (Object.is(this.currentSlot.selection, selection)) return this.activate(this.currentSlot);
    const previous = this.currentSlot;
    const slot = this.createSlot(selection);
    this.currentSlot = slot;
    this.snapshot = this.createSnapshot(slot);
    // Install the new selection before cleanup can synchronously select again.
    this.releaseSlot(previous);
    if (this.currentSlot !== slot || !this.isOpen()) return Promise.reject(new EnboxBindingChangedError());
    this.notify();
    return this.activate(slot);
  };

  public readonly ready = (options: { signal?: AbortSignal } = {}): Promise<
    Extract<SelectedRecordSnapshot<Item, Selection>, { status: 'ready' }>
  > => {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new EnboxBindingChangedError());
    const slot = this.currentSlot;
    if (!this.isOpen() || slot.selection === null) return Promise.reject(new EnboxBindingChangedError());
    void this.activate(slot).catch(() => {});
    return slot.observer.ready(options).then((state) => {
      if (this.currentSlot !== slot || !this.isOpen()) throw new EnboxBindingChangedError();
      // Preserve the state that settled the waiter, even if a later update arrived.
      return (slot.viewSnapshot === state ? this.snapshot : this.createSnapshot(slot, state)) as
        Extract<SelectedRecordSnapshot<Item, Selection>, { status: 'ready' }>;
    });
  };

  public readonly retry = (): Promise<void> => this.retrySlot(this.currentSlot);
  public readonly loadMore = (): Promise<void> => {
    if (!this.isOpen()) return Promise.reject(new EnboxBindingChangedError());
    return this.currentSlot.observer.loadMore();
  };
  public readonly updateRecords = (update: (records: readonly Item[]) => readonly Item[]): void => {
    if (!this.isOpen() || this.currentSlot.selection === null) throw new EnboxBindingChangedError();
    void this.activate(this.currentSlot).catch(() => {});
    this.currentSlot.observer.updateRecords(update);
  };

  public readonly close = async (): Promise<void> => {
    if (!this.closed) {
      this.closed = true;
      this.config.signal?.removeEventListener('abort', this.onAbort);
      this.snapshot = this.idle;
      this.releaseSlot(this.currentSlot);
      this.notify();
      this.listeners.clear();
    }
    await Promise.all([...this.closingObservers].map((observer) => observer.close().catch(reportCleanupError)));
  };

  private readonly onAbort = (): void => { void this.close(); };
  private isOpen(): boolean { return !this.closed && this.config.signal?.aborted !== true; }

  private createSlot(selection: Selection | null): SelectionSlot<Item, Selection> {
    const open = selection === null ? null : (signal: AbortSignal) => this.config.open(selection, signal);
    const observer = new RecordViewObserver<Item>(open, {
      retainWithoutSubscribers: true,
      loadAll: this.config.loadAll === true,
    });
    const slot: SelectionSlot<Item, Selection> = {
      selection, observer, viewSnapshot: observer.getSnapshot(),
      serverSnapshot: Object.freeze({ ...observer.getServerSnapshot(), selection }),
    };
    // Retained snapshots must retry their own selection, never a replacement.
    slot.serverSnapshot = Object.freeze({ ...slot.serverSnapshot, retry: () => this.retrySlot(slot) });
    return slot;
  }

  private createSnapshot(slot: SelectionSlot<Item, Selection>, state = slot.viewSnapshot): SelectedRecordSnapshot<Item, Selection> {
    return Object.freeze({ ...state, selection: slot.selection, retry: slot.serverSnapshot.retry });
  }

  private activate(slot: SelectionSlot<Item, Selection>): Promise<void> {
    if (!this.isOpen() || this.currentSlot !== slot) return Promise.reject(new EnboxBindingChangedError());
    if (slot.selection === null) return Promise.resolve();
    if (slot.opening !== undefined) return slot.opening;
    const unsubscribe = slot.observer.subscribe(() => {
      if (!this.isOpen() || this.currentSlot !== slot) return;
      const snapshot = slot.observer.getSnapshot();
      if (slot.viewSnapshot === snapshot) return;
      slot.viewSnapshot = snapshot;
      this.snapshot = this.createSnapshot(slot);
      this.notify();
    });
    if (!this.isOpen() || this.currentSlot !== slot) {
      unsubscribe();
      return Promise.reject(new EnboxBindingChangedError());
    }
    slot.unsubscribe = unsubscribe;
    return this.trackOpening(slot, slot.observer.retry());
  }

  private retrySlot(slot: SelectionSlot<Item, Selection>): Promise<void> {
    if (!this.isOpen() || this.currentSlot !== slot || slot.selection === null) return Promise.reject(new EnboxBindingChangedError());
    if (slot.opening === undefined) return this.activate(slot);
    return this.trackOpening(slot, slot.observer.retry());
  }

  private trackOpening(slot: SelectionSlot<Item, Selection>, observerOpening: Promise<void>): Promise<void> {
    if (slot.observerOpening === observerOpening && slot.opening !== undefined) return slot.opening;
    slot.observerOpening = observerOpening;
    slot.opening = observerOpening.then(() => {
      if (!this.isOpen() || this.currentSlot !== slot) throw new EnboxBindingChangedError();
    });
    void slot.opening.catch(() => {});
    return slot.opening;
  }

  private releaseSlot(slot: SelectionSlot<Item, Selection>): void {
    const unsubscribe = slot.unsubscribe;
    delete slot.unsubscribe;
    unsubscribe?.();
    const observer = slot.observer;
    // Native close can reenter owner.close(), which must include this cleanup.
    this.closingObservers.add(observer);
    void observer.close().catch(reportCleanupError).then(() => { this.closingObservers.delete(observer); });
  }

  private notify(): void {
    notifyListeners(this.listeners);
  }
}
