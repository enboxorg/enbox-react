import { useObservableStore, type ObservableStoreSource } from '@enbox/react';

type Snapshot = Readonly<{ count: number; label: string }>;
declare const source: ObservableStoreSource<Snapshot>;
declare const optional: ObservableStoreSource<Snapshot> | null | undefined;

export function ObservableStoreContracts(): void {
  const snapshot: Snapshot = useObservableStore(source, { count: 0, label: 'none' });
  const selected: number = useObservableStore(source, 0, (value) => value.count);
  const label: string = useObservableStore(optional, 'none', (value) => value.label);
  const object: Readonly<{ value: number }> = useObservableStore(
    source, { value: 0 }, (value) => ({ value: value.count }),
    (previous, next) => previous.value === next.value,
  );
  const missing: number = useObservableStore(undefined, 0, (value: Snapshot) => value.count);
  void snapshot;
  void selected;
  void label;
  void object;
  void missing;

  // @ts-expect-error the two-argument fallback must match the source snapshot
  useObservableStore(source, 0);
  // @ts-expect-error selected fallback must match the selector result, not its input
  useObservableStore(source, { count: 0, label: 'none' }, (value) => value.count);
  // @ts-expect-error selectors retain the source snapshot type
  useObservableStore(source, 0, (value) => value.missing);
  // @ts-expect-error equality compares selected values
  useObservableStore(source, 0, (value) => value.count, (previous: string, next: string) => previous === next);
}
