import { useStore, type StoreSource } from '@enbox/react';

type Snapshot = Readonly<{ count: number; label: string }>;
declare const source: StoreSource<Snapshot>;
declare const optional: StoreSource<Snapshot> | null | undefined;

export function ObservableStoreContracts(): void {
  const snapshot: Snapshot = useStore(source, { fallback: { count: 0, label: 'none' } });
  const selected: number = useStore(source, { fallback: 0, selector: (value) => value.count });
  const label: string = useStore(optional, { fallback: 'none', selector: (value) => value.label });
  const object: Readonly<{ value: number }> = useStore(source, {
    fallback: { value: 0 },
    selector: (value) => ({ value: value.count }),
    isEqual: (previous, next) => previous.value === next.value,
  });
  const missing: number = useStore(undefined, { fallback: 0, selector: (value: Snapshot) => value.count });
  const absent: number = useStore(null, { fallback: 0 });
  void snapshot;
  void selected;
  void label;
  void object;
  void missing;
  void absent;

  // @ts-expect-error a plain store needs an explicit SSR fallback
  useStore(source);
  // @ts-expect-error an optional source needs an explicit absent fallback
  useStore(optional, { selector: (value) => value.count });

  // @ts-expect-error the two-argument fallback must match the source snapshot
  useStore(source, { fallback: 0 });
  // @ts-expect-error selected fallback must match the selector result, not its input
  useStore(source, { fallback: { count: 0, label: 'none' }, selector: (value) => value.count });
  // @ts-expect-error selectors retain the source snapshot type
  useStore(source, { fallback: 0, selector: (value) => value.missing });
  // @ts-expect-error equality compares selected values
  useStore(source, { fallback: 0, selector: (value) => value.count, isEqual: (previous: string, next: string) => previous === next });
}
