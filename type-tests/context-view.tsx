import type { ContextMaterializedRecord, ContextView, MaterializedMemberContext, MemberContext, ProtocolContext, TypedEnbox } from '@enbox/browser';
import type { ContextStore, ContextViewResult } from '@enbox/react';

import { useContextView } from '@enbox/react';
import { createContextStore, defineProtocol, recordCodecs } from '@enbox/react/config';

const protocol = defineProtocol({
  protocol: 'https://example.test/context-view-contracts', published: false,
  types: {
    notebook: { dataFormats: ['application/json'], encryptionRequired: true },
    member: { dataFormats: ['application/json'] },
  },
  structure: { notebook: {
    $actions: [{ role: 'notebook/member', can: ['read'] }], member: { $role: true },
  } },
} as const, {
  notebook: recordCodecs.json<{ title: string }>(),
  member: recordCodecs.json<{ label: string }>(),
}, { roleGroups: { default: ['notebook/member'] } });

declare const native: TypedEnbox<typeof protocol.definition, typeof protocol.codecs, typeof protocol.roleGroups>;
const open = (signal: AbortSignal) => native.contexts.observe({ signal });
const materializedOpen = (signal: AbortSignal) => native.contexts.observe({ access: 'member', materializeRoot: true, signal });
type NativeContext = ProtocolContext<typeof protocol.definition, typeof protocol.codecs, typeof protocol.roleGroups>;
type NativeMaterializedContext = MaterializedMemberContext<
  MemberContext<typeof protocol.definition, typeof protocol.codecs, 'notebook/member'>,
  ContextMaterializedRecord<{ title: string }>
>;
const shared = createContextStore(open);

export function ContextViewContracts(): void {
  const nativeView: Promise<ContextView<NativeContext>> = open(new AbortController().signal);
  void nativeView;
  const result = useContextView(open);
  const nativeContext: NativeContext | undefined = result.contexts[0];
  const wrapperContext: (typeof result.contexts)[number] | undefined = nativeContext;
  const path: 'notebook' | undefined = wrapperContext?.path;
  const ownerDid: string | undefined = wrapperContext?.ownerDid;
  void path;
  void ownerDid;
  if (wrapperContext?.access === 'member') {
    const role: 'notebook/member' = wrapperContext.role;
    const leaving: Promise<void> = wrapperContext.leave();
    void role;
    void leaving;
    // @ts-expect-error member contexts do not expose owner membership management
    wrapperContext.members;
  }
  if (wrapperContext?.access === 'owner') {
    const members = wrapperContext.members();
    void members;
    // @ts-expect-error owner contexts cannot leave another owner's membership
    wrapperContext.leave();
  }
  const store: ContextStore<NativeContext> = shared;
  const borrowed: ContextViewResult<NativeContext> = useContextView(store);
  const borrowedContext: NativeContext | undefined = borrowed.contexts[0];
  const ready: Promise<Extract<ContextViewResult<NativeContext>, { status: 'ready' }>> = store.ready();
  void borrowedContext;
  void ready;
  const retry: Promise<void> = borrowed.retry();
  void retry;

  const materialized = useContextView(materializedOpen);
  const nativeMaterialized: NativeMaterializedContext | undefined = materialized.contexts[0];
  const wrapperMaterialized: (typeof materialized.contexts)[number] | undefined = nativeMaterialized;
  const title: string | undefined = wrapperMaterialized?.root.records[0]?.value.title;
  const memberAccess: 'member' | undefined = wrapperMaterialized?.context.access;
  const role: 'notebook/member' | undefined = wrapperMaterialized?.context.role;
  void title;
  void memberAccess;
  void role;
  const materializedStore = createContextStore(materializedOpen);
  const sharedTitle: string | undefined = useContextView(materializedStore).contexts[0]?.root.records[0]?.value.title;
  void sharedTitle;
  // @ts-expect-error materialized roots preserve their exact codec payload
  wrapperMaterialized?.root.records[0]?.value.label;

  const idle = useContextView<NativeContext>(null);
  const idleContexts: readonly NativeContext[] = idle.contexts;
  void idleContexts;
  // @ts-expect-error context catalogs do not have record rows
  result.records;
  // @ts-expect-error context catalogs do not invent replication currentness
  result.current;
  // @ts-expect-error context catalogs do not invent pagination controls
  result.loadMore();
  // @ts-expect-error context owner stores do not invent pagination controls
  store.loadMore();
  // @ts-expect-error context catalogs do not invent pagination state
  result.hasMore;
  // @ts-expect-error context catalogs do not invent pagination progress
  result.isLoadingMore;
  // @ts-expect-error a record opener is not a context catalog opener
  createContextStore((signal) => native.records.observe('notebook', { pagination: { limit: 10 }, signal }));
}
