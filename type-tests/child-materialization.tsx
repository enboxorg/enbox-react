import type { ExpandableRecordView, TypedEnbox, TypedMaterializedRecord, TypedRecord } from '@enbox/browser';
import type { RecordsOptions, RecordsResult } from '@enbox/react';

import { useRecords } from '@enbox/react';
import { defineProtocol, recordCodecs } from '@enbox/react/config';

type Page = { title: string };
type Live = { channel: string };
type Stats = { words: number };
const protocol = defineProtocol({
  protocol: 'https://example.test/child-materialization', published: false,
  types: {
    folder: { dataFormats: ['application/json'] },
    page: { dataFormats: ['application/json'] },
    live: { dataFormats: ['application/json'] },
    stats: { dataFormats: ['application/json'] },
    presence: { dataFormats: ['application/json'] },
    attachment: { dataFormats: ['application/json'] },
    metadata: { dataFormats: ['application/json'] },
  },
  structure: {
    folder: {
      page: {
        live: { $recordLimit: { max: 1 }, presence: { $recordLimit: { max: 1 } } },
        stats: { $recordLimit: { max: 1 } },
        attachment: { $recordLimit: { max: 10 } },
      },
      metadata: { $recordLimit: { max: 1 } },
    },
  },
} as const, {
  folder: recordCodecs.json<{ name: string }>(),
  page: recordCodecs.json<Page>(),
  live: recordCodecs.json<Live>(),
  stats: recordCodecs.json<Stats>(),
  presence: recordCodecs.json<{ did: string }>(),
  attachment: recordCodecs.json<{ filename: string }>(),
  metadata: recordCodecs.json<{ description: string }>(),
});

declare const native: TypedEnbox<typeof protocol.definition, typeof protocol.codecs>;
type NativeView = Awaited<ReturnType<typeof native.records.observe<
  'folder/page', { children: readonly ['folder/page/live', 'folder/page/stats'] }
>>>;
type NativeRow = NativeView extends ExpandableRecordView<infer Row> ? Row : never;

export function ChildMaterializationContracts(): void {
  const result = useRecords(protocol, 'folder/page', {
    within: 'folder-context', pagination: { limit: 10 },
    materialize: { children: ['folder/page/live', 'folder/page/stats'] },
  });
  const nativeRow: NativeRow | undefined = result.records[0];
  const wrapperRow: (typeof result.records)[number] | undefined = nativeRow;
  const channel: string | undefined = wrapperRow?.children.live?.value.channel;
  const words: number | undefined = wrapperRow?.children.stats?.value.words;
  const title: string | undefined = wrapperRow?.value.title;
  void channel;
  void words;
  void title;
  // @ts-expect-error child codec values do not inherit parent fields
  wrapperRow?.children.live?.value.title;
  // @ts-expect-error decoded child field types remain inferred
  const invalidWords: string | undefined = wrapperRow?.children.stats?.value.words;
  void invalidWords;

  const selected = useRecords(protocol, 'folder/page', {
    within: 'folder-context', pagination: { limit: 10 },
    materialize: { children: ['folder/page/live'] },
  });
  const selectedChannel: string | undefined = selected.records[0]?.children.live?.value.channel;
  void selectedChannel;
  // @ts-expect-error only selected children are projected
  selected.records[0]?.children.stats;

  const reusable = {
    within: 'folder-context', pagination: { limit: 10 },
    materialize: { children: ['folder/page/live'] as const },
  } satisfies RecordsOptions<typeof protocol.definition, 'folder/page'>;
  const reusedChannel: string | undefined = useRecords(protocol, 'folder/page', reusable)
    .records[0]?.children.live?.value.channel;
  void reusedChannel;

  const annotated: RecordsOptions<typeof protocol.definition, 'folder/page'> = reusable;
  const annotatedRows = useRecords(protocol, 'folder/page', annotated);
  const compatible: RecordsResult<TypedRecord<Page> | TypedMaterializedRecord<Page>> = annotatedRows;
  void compatible;
  const annotatedRow = annotatedRows.records[0];
  if (annotatedRow && 'children' in annotatedRow) {
    const decoded: string | undefined = annotatedRow.children.live?.value.channel;
    void decoded;
  }

  const scopedOptions: RecordsOptions<
    typeof protocol.definition, 'folder/page', { children: readonly ['folder/page/live'] }
  > = reusable;
  const scopedRow = useRecords(protocol, 'folder/page', scopedOptions).records[0];
  if (scopedRow && 'children' in scopedRow) {
    const decoded: string | undefined = scopedRow.children.live?.value.channel;
    void decoded;
    // @ts-expect-error annotated child selections retain their exact paths
    scopedRow.children.stats;
  }

  const parentOnly = useRecords(protocol, 'folder/page', {
    within: 'folder-context', pagination: { limit: 10 }, materialize: true,
  });
  const parent: TypedMaterializedRecord<Page> | undefined = parentOnly.records[0];
  void parent;
  // @ts-expect-error parent-only materialization does not imply children
  parentOnly.records[0]?.children;
  const handles = useRecords(protocol, 'folder/page', {
    within: 'folder-context', pagination: { limit: 10 },
  });
  const handle: TypedRecord<Page> | undefined = handles.records[0];
  void handle;
  // @ts-expect-error native record handles remain lazy
  handles.records[0]?.children;

  // @ts-expect-error shorthand child names do not identify exact protocol paths
  useRecords(protocol, 'folder/page', { within: 'folder-context', pagination: { limit: 10 }, materialize: { children: ['live'] } });
  // @ts-expect-error a descendant below two edges is not a direct child
  useRecords(protocol, 'folder/page', { within: 'folder-context', pagination: { limit: 10 }, materialize: { children: ['folder/page/live/presence'] } });
  // @ts-expect-error child eligibility follows the native singleton limit
  useRecords(protocol, 'folder/page', { within: 'folder-context', pagination: { limit: 10 }, materialize: { children: ['folder/page/attachment'] } });
  // @ts-expect-error singleton siblings do not belong to this parent
  useRecords(protocol, 'folder/page', { within: 'folder-context', pagination: { limit: 10 }, materialize: { children: ['folder/metadata'] } });
  // @ts-expect-error unknown singleton paths must not widen the definition
  useRecords(protocol, 'folder/page', { within: 'folder-context', pagination: { limit: 10 }, materialize: { children: ['folder/page/missing'] } });
  // @ts-expect-error root selection must not widen to make a grandchild legal
  useRecords(protocol, 'folder', { pagination: { limit: 10 }, materialize: { children: ['folder/page/live'] } });
  // @ts-expect-error child materialization still requires a nested context selector
  useRecords(protocol, 'folder/page', { pagination: { limit: 10 }, materialize: { children: ['folder/page/live'] } });
  // @ts-expect-error false is not native materialization
  useRecords(protocol, 'folder/page', { within: 'folder-context', pagination: { limit: 10 }, materialize: false });
}
