import type { RecordView } from '@enbox/browser';
import type { RecordStore, RecordViewResult } from '@enbox/react';

import { useRecords, useRecordView } from '@enbox/react';
import { createRecordStore } from '@enbox/react/config';

type Row = { title: string };
declare const open: (selection: string, signal: AbortSignal) => Promise<RecordView<Row>>;
const store = createRecordStore({ selection: null as string | null, open });

declare const clientOnly: RecordStore<Row> & {
  getSnapshot(): RecordViewResult<Row> & { liveOnly: string };
};

declare const withPaginationMetadata: RecordStore<Row> & {
  getSnapshot(): RecordViewResult<Row> & { loadMore: string };
  getServerSnapshot(): RecordViewResult<Row> & { loadMore: string };
};

export function SelectedStoreContracts(): void {
  const paginated = useRecords(withPaginationMetadata);
  const page: Promise<void> = paginated.loadMore();
  void page;
  // @ts-expect-error the hook's pagination control replaces a same-named snapshot field
  const wrongPagination: string = paginated.loadMore;
  void wrongPagination;
  const maybeServer = useRecordView(clientOnly);
  const maybeServerRecords = useRecords(clientOnly);
  // @ts-expect-error server snapshots need not contain client-only metadata
  maybeServer.liveOnly;
  // @ts-expect-error paginated record hooks preserve the same SSR constraint
  maybeServerRecords.liveOnly;
  const snapshot = useRecordView(store);
  const selection: string | null = snapshot.selection;
  const records = useRecords(store);
  const recordSelection: string | null = records.selection;
  const recordTitle: string | undefined = records.records[0]?.title;
  void recordSelection; void recordTitle;
  // @ts-expect-error shared record hooks retain their selection type
  const wrongSelection: number = records.selection;
  void wrongSelection;
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
