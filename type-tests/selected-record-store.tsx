import type { RecordView } from '@enbox/browser';
import { useRecordView } from '@enbox/react';
import { createRecordStore } from '@enbox/react/config';

type Row = { title: string };
declare const open: (selection: string, signal: AbortSignal) => Promise<RecordView<Row>>;
const store = createRecordStore({ selection: null as string | null, open });

export function SelectedStoreContracts(): void {
  const snapshot = useRecordView(store);
  const selection: string | null = snapshot.selection;
  const title: string | undefined = snapshot.records[0]?.title;
  const attaching: Promise<void> = store.select('folder');
  const released: Promise<void> = store.select(null);
  store.updateRecords((rows) => [...rows, { title: 'Created' }]);
  void selection; void title; void attaching; void released;
  // @ts-expect-error selected keys preserve their exact input type
  store.select(123);
  // @ts-expect-error record payloads remain inferred for transient updates
  store.updateRecords(() => [{ title: 123 }]);
  // @ts-expect-error borrowed stores retain record payloads
  const wrong: number | undefined = snapshot.records[0]?.title;
  void wrong;
}
