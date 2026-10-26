# Enbox React

React subscriptions for Enbox application stores, typed live records, and
authorization-bound commands. Headless store definitions and resource ownership
live in `@enbox/api`, also re-exported by `@enbox/browser`.

## Create a dapp

The `@enbox/create-dapp` generator creates a standalone React application with wallet connection, a public
profile card, and an encrypted personal task board. The demo lives entirely
under `src/features/tasks/`; application setup lives under `src/app/`, and the
connection and profile shell can stay as you build.

```sh
npm create @enbox/dapp@latest my-app
cd my-app
npm install
npm run dev
```

To try the generator from this checkout, use
`node packages/create-dapp/bin/create-dapp.mjs my-app` instead of `npm create`.
See [the generator](packages/create-dapp/README.md) and
[the starter](packages/create-dapp/template/README.md) for customization.

## Work on the SDK and starter

```sh
bun install --frozen-lockfile
bun run check
bun run starter:dev
```

`starter:dev` builds and packs the local SDK, installs it in the starter without
changing the template manifest, and serves its source with Vite. It works before
the SDK version is published. Vite reloads starter source edits; restart
`starter:dev` after changing SDK source to pack and install the new build.
`bun run test:browser` instead packs the current SDK and generator, creates an
app outside this repository, and verifies fresh npm/Bun installs, subsequent
frozen installs, types, production build, worker control, and offline reload. Connected-UI tests use
a controlled native client; they do not approve a real wallet account.

The starter registers its application-owned worker before rendering or
initializing Enbox. The browser SDK automatically activates updated workers.

Runtime and development dependencies use exact versions; peers accept only
the explicitly tested releases. Bun defaults to exact saves, frozen lockfile
installs, and no automatic runtime installs;
npm also saves exact versions. The current peer pins are `@enbox/browser`
`0.3.82` and React `18.3.1` or `19.3.0`. Development setup and intentional
version changes are documented in
[CONTRIBUTING.md](https://github.com/enboxorg/enbox-react/blob/main/CONTRIBUTING.md).

## Application stores

Define protocol resources and domain actions in `features/<feature>/store.ts`:

```ts
import { defineStore } from '@enbox/browser';
import { NotesProtocol } from './protocol.js';

export const NotesStore = defineStore({
  protocols: { notes: NotesProtocol },
  create({ protocols, command }) {
    const notes = protocols.notes.collection('note');
    return {
      notes,
      addNote: command((title: string) => notes.create.run({ title: title.trim() })),
    };
  },
});
```

Register the feature with native `defineApplication({ stores: { notes: NotesStore } })`.
Use its `manifest` when constructing the native connection, then pass that
connection to `createApplication(definition, { connection })`. The generated
`app/application.ts` and `app/runtime.ts` demonstrate this browser-lifetime setup.
Mount `<EnboxProvider application={runtime}>` to borrow that runtime in React.

```tsx
import { useFeature, useStore } from '@enbox/react';
import { NotesStore } from './store.js';

export function Notes() {
  const feature = useFeature(NotesStore);
  const notes = useStore(feature.notes);
  const creation = useStore(feature.addNote);
  return <>
    <button disabled={creation.pendingCount > 0}
      onClick={() => { void feature.addNote.run('Hello'); }}>Add note</button>
    {creation.error && <p role="alert">{creation.error.message}</p>}
    {notes.records.map(({ record, value }) => <p key={record.id}>{value.title}</p>)}
  </>;
}
```

`useFeature` resolves one store instance for the current authorization scope.
`useStore(resource, selector?, isEqual?)` subscribes to immutable snapshots and
retains resources only after React commits. Equivalent collection selections
share native views and command progress across components and headless code.
Nested paths expose keyed families such as `feature.pages.within(notebookContextId)`.
The starter's list and detail panel select the same task collection.

Headless consumers resolve the same instance with `runtime.store(NotesStore)`.
They retain resources explicitly, await `ready()`, and release their leases when
finished. `ready()` alone holds temporary ownership. Session replacement retires
old feature instances and captured commands. `run()` preserves the native outcome
and publishes command errors; completion represents local acceptance, while
replication freshness stays in native snapshots.

The runtime owner calls `dispose()` at application shutdown. The React provider
initializes a supplied application by default and leaves its disposal to that
owner. Browser worker preparation still happens before rendering.

## Lower-level record bindings

| Need | API |
| --- | --- |
| A local list with typed create, patch, and delete | `useEnboxRecords(protocol, path, options)` |
| One record by ID, or a schema-declared singleton by path | `useEnboxRecord(protocol, path, options)` |
| Remote or role-authorized reads, lazy payloads, selected child materialization | `useRecords(protocol, path, options)` |
| A custom native command, including metadata or file operations | `useEnboxMutation(operation)` |
| One view shared by components and controllers | `createRecordStore` with `useRecords(store)` |
| A selected slice of an existing store | `useObservableStore(store, fallback, selector)` |

Domain hooks such as `useTasks(projectContextId)` fix paths and options in one
module. Each call still owns its own view and mutation state. To share both,
call the domain hook once in a parent and pass its result through props or
context. For a view also used by headless controllers, create a store for the
owning session/page, pass it through props or context, and close it or abort its
owner signal when that scope ends. Give shared filters and pagination one owner.

## Define the application

`@enbox/react/config` contains ordinary SDK authoring exports and an inert
client factory. It has no React client directive.

```ts
import type { CreateEnboxClientOptions } from '@enbox/react/config';

import {
  defineApplicationManifest,
  defineProtocol,
  recordCodecs,
} from '@enbox/react/config';

type Note = { title: string };

export const NotesProtocol = defineProtocol({
  protocol: 'https://example.com/my-notes/v1',
  published: false,
  types: { note: { dataFormats: ['application/json'], encryptionRequired: true } },
  structure: { note: {} },
} as const, { note: recordCodecs.json<Note>() });

export const config = {
  application: defineApplicationManifest({ protocols: [NotesProtocol] }),
  wallet: { appName: 'My notes', appIcon: '/icon.svg' },
} satisfies CreateEnboxClientOptions;
```

Protocol identifiers should be stable URLs owned by your application.
`recordCodecs.json<T>()` provides type inference; pass a standalone `validator`
for runtime validation. The starter demonstrates a small domain validator.

The factory returns the native `ConnectionStore`. It creates no manager,
storage, socket, or browser UI until initialization or a connection action.
Pass native store options under `connection`, or supply an explicit
`connectHandler` instead of `wallet`. Existing stores can also be passed
directly to the provider.

Status monitoring uses the SDK default. Interactive grant refresh is opt-in:
`connection: { monitor: { autoRefresh: {} } }`. It invokes wallet approval;
normal renewal can be initiated with the existing `connect()` action.

## Mount the provider

```tsx
import { EnboxProvider } from '@enbox/react';
import { config } from './application.js';

export function App() {
  return <EnboxProvider config={config}><Notes /></EnboxProvider>;
}
```

With `config`, the provider creates, initializes, and disposes the client.
Configuration is fixed for the mounted scope; use a new provider key to
change it. Strict Mode replay keeps the live client. Effect reactivation
after Activity retirement creates a fresh client and restores its session.

If controllers outside React already use a client, pass that same instance
with `client={client}`. In a browser-only app, create it once outside rendering:

```tsx
import { createEnboxClient } from '@enbox/react/config';

const client = createEnboxClient(config);

export function App() {
  return <EnboxProvider client={client}><Notes /></EnboxProvider>;
}
```

With an existing client, the application calls `client.dispose()` when retiring
it. Both provider forms initialize by default. `disconnect()` signs out.
`initializeOnMount={false}` lets a host finish worker bootstrap before calling
`client.initialize()` itself.

For SSR, the initial shell is deterministic and contains no session. Create
the store within the client application boundary, use fresh inert instances
on the server, and retain a browser instance for the application lifetime.
Pass client components through your framework's client boundary; store
instances and codec-bearing manifests are not serializable RSC props.

## Connect a wallet or local vault

`useEnboxConnection` is the default React path for wallet `connect()`, local
`connectVault()`, and `disconnect()`. They share provider-scoped progress,
errors, application guards, and lifecycle checks.

```tsx
import { useEnboxConnection } from '@enbox/react';

function WalletButton() {
  const connection = useEnboxConnection();
  return <button disabled={connection.isConnecting || connection.isDisconnecting}
    onClick={() => { void connection.connect().catch(reportError); }}>
    {connection.isConnected ? connection.identityName ?? connection.did : 'Connect wallet'}
  </button>;
}
```

The hook provides usable connection state and wallet repair. Its actions reject
actionable failures while treating wallet denial quietly.
A per-call `connect({ wallet: options })` inherits the
client factory's wallet defaults while changing the wallet route, for both
configured and existing clients. Explicit per-call fields override those defaults.
For a native store created outside `createEnboxClient`, supply the app identity
in the per-call wallet options.

For an application-owned HD vault, use the same hook with native vault options:

```tsx
function LocalVaultButton({ password }: { password: string }) {
  const connection = useEnboxConnection();
  return <button disabled={connection.isConnecting || connection.isDisconnecting}
    onClick={() => { void connection.connectVault({ password, createIdentity: true }).catch(reportError); }}>
    Use local vault
  </button>;
}
```

`createIdentity: true` creates a default identity when none exists; the native
default is false. Local vault ownership still supports native sync. Collect
the password in application UI, pass it per call, or configure native
`connection.password` / `connection.passwordProvider` defaults for connection
and restoration. Read native session data through `useConnection`, including
the optional `snapshot.session?.recoveryPhrase` from first-time vault setup.
Recovery-phrase display and acknowledgment belong to the application;
phrase import is a separate native workflow, not a `connectVault` option.

Both connect methods share one pending operation; concurrent calls join the
first action and its options. Pass `beforeConnect` or `beforeDisconnect` to
the provider for application guards, such as saving edits. `beforeConnect`
receives `{ action, options, snapshot }`: `action` is `connect` or `connectVault`,
and narrowing it also narrows `options` to `ConnectOptions` or native
`VaultConnectOptions`, respectively. Options can be undefined. Disconnect
progress includes its guard. Failed guards preserve the connected session. An explicit
`disconnect({ skipBeforeDisconnect: true })` bypasses that guard; the host
owns the decision and its UI. Binding changes during an awaited guard prevent
the action from targeting a replacement identity.

Provider retirement also invalidates captured connection actions and fences
guards still awaiting application work. Strict Mode replay preserves them;
Activity resumption after retirement creates a fresh workflow controller.
Operations already issued to the native client keep their original Promise
outcome.

## Resolve profiles

`useProfile(enbox, did)` reads one published profile; `useProfiles(enbox, dids)`
returns a map of the same result shape keyed by DID. Each result includes text,
`avatarUrl`, `heroUrl`, `status`, and native per-field status/failure metadata
under `fields`. They share native readers by source and image policy, manage image URL
leases, and release watches on unmount. Unchanged DID results retain their
references when another person updates.

```tsx
const person = useProfile(enbox, did, { images: 'off' });
if (person.status === 'loading') return <p>Looking up profile…</p>;
if (person.fields.profile.failure) return <p>Profile lookup failed.</p>;
return <span>{person.displayName ?? did}</span>;
```

Status is `idle`, `loading`, `settled`, `not-found`, or `error`; it reflects the
fields requested by this consumer. Image failures remain visible in
`fields.avatar` or `fields.hero` while usable text stays available. A missing
profile and a failed lookup are distinct results.

Both hooks accept `{ enabled, images }`. Images default to `eager` for existing
consumers; use `off` for text-only lists or `lazy` to defer image downloads until
calling the result's `loadImages()`. Field failures appear in metadata;
disabled or retired controls reject. Empty or disabled selections perform no reads. The
existing `useProfile(enbox, did, false)` form still disables the lookup.
No provider is required for an explicit source, including `Enbox.anonymous()`.
Text-only consumers use a native reader with images disabled, so earlier
image requests cannot make later text lookups download images. Explicit lazy
activation can perform another root-profile read; already usable text remains
visible while that read settles.

## Read and write records

Define small domain hooks in an ordinary module:

```tsx
import { useEnboxRecords } from '@enbox/react';
import { NotesProtocol } from './application.js';

export function useNotes() {
  return useEnboxRecords(NotesProtocol, 'note');
}

export function Notes() {
  const notes = useNotes();
  return <>
    <button disabled={!notes.isReady || notes.create.isPending}
      onClick={() => notes.create.mutate({ title: 'Hello' })}>Add note</button>
    {notes.create.error && <p role="alert">{notes.create.error.message}</p>}
    {notes.error && <p role="alert">{notes.error.message}</p>}
    <ul>{notes.records.map(({ id, data }) => <li key={id}>{data.title}</li>)}</ul>
  </>;
}
```

`useEnboxRecords` materializes a local, session-owned collection with `create`,
`patch`, and `delete` commands. Rows expose `id`, `contextId`, decoded `data`,
and the native `record`. Data is a read-only TypeScript snapshot; use commands
to persist edits. `patch.mutate({ id, patch })` updates selected fields;
`delete.mutate(id)` deletes a record. Patch/delete provide `isPendingFor(id)`
for row controls. Payloads and patches follow the protocol's codecs.
A patch can also be a pure producer, such as
`oneNote.patch.mutate((current) => ({ done: !current.done }))`. It receives the
native current value and may return `undefined` to skip the write. Native
conflict recovery may call it again, so keep UI effects outside the producer.

`useEnboxRecord(Protocol, path, { recordId, within })` reads one record and
provides its `data`, native `record`, `patch`, and `delete` commands. Root paths
omit `within`. Its commands stay bound to that ID regardless of the displayed data.

For paths declaring `$recordLimit.max: 1`, omit the ID:

```tsx
const settings = useEnboxRecord(SettingsProtocol, 'settings');
// Nested singleton: useEnboxRecord(Protocol, 'project/settings', { within: projectContextId })

if (settings.isLoading) return <p>Loading settings…</p>;
if (settings.error) return <p role="alert">{settings.error.message}</p>;
if (settings.isMissing) return <p>No settings saved yet.</p>;
```

Both forms expose one `record` and decoded `data` directly, with no array to
index. `isMissing` means the local view is ready and empty; it is false while
the read is idle, loading, or failed. A live empty selection is represented as missing
rather than an HTTP error. Native one-shot reads translate 404 to `undefined`.

Path-selected singletons also provide `set.mutate(data)`, delegating to native
`records.set` to create or replace the occupant. Patch/delete resolve the current
occupant through native `records.read` when invoked, independently of observation
readiness. A missing occupant makes patch reject with native-shaped 404 and delete
succeed without a write. Lookup failures propagate. Native authorization and
concurrency rules still apply. Ordinary collection paths require an explicit ID.

For public profiles from another DID, use `useProfile`; it owns remote profile
settlement and image resources. These local CRUD hooks operate on the connected
session's application records.

Nested hooks require their direct parent's exact context ID; root selections
reject `within`. Pass `null` while no parent is selected. `enabled: false`
pauses reads while preserving a valid command scope. Query filters affect only
reads and are never merged into writes. Parent changes retire captured commands;
patch/delete check that a supplied ID belongs to the selected parent.

`mutate` is an event-handler action: native failures appear in the command's
`error`. `mutateAsync` returns the native result and rejects with the original
cause. Each command has its own pending/error state. Use explicit async code
for draft clearing or navigation:

```tsx
async function addNote() {
  try {
    await notes.create.mutateAsync({ title: draft });
    if (notes.create.isCurrent()) setDraft('');
  } catch {
    // Render notes.create.error alongside the form.
  }
}
```

The captured command's `isCurrent()` checks its session, selection, and
subscription lifetime before caller UI effects after `await`. Draft versions
and other application state remain application-owned. Native views update
displayed data; these hooks add no optimistic overlay or write retry.

The collection defaults to a page limit of 20; pass `pagination` to change it.
`loadMore()` and `retry()` publish failures in query state. Their returned
Promises still reject when awaited, and ignoring them in event handlers is safe.
Each hook owns its view; use the shared-store APIs below when multiple consumers
need to share one view. No global private-data cache or state-library dependency
is introduced. The generated example instead uses a shared feature store under
`src/features/tasks/`, with React and headless consumers sharing the same resources.

Use the lower-level `useRecords` and `useEnboxMutation` for remote or
role-authorized operations, lazy file payloads, custom creates, and other
native SDK features. `useRecords(Protocol, path, options)` retains its existing
materialization and pagination contracts:

Without `materialize`, rows are native record handles and their payloads
remain lazy. `materialize: { children: ['note/preview'] }` also decodes selected
direct singleton children alongside each parent, with inferred child values
under `row.children.preview`. Selected children must declare
`$recordLimit.max: 1`; the SDK validates malformed selections. A positive
`pagination.limit` is required. `loadMore()` expands
the retained prefix; `retry()` reopens the original selection and page limit.
Both controls return Promises that reject on failure and also publish errors
in the result. Concurrent opening or pagination calls share their Promise.
Pass `null` options or `enabled: false` to release a view and return idle.

`ready` means local rows are usable. `current` reports replication freshness;
it can be false while useful saved data remains visible. The SDK drives live
changes without a polling or cache-invalidation loop.

## Share records with application controllers

When startup, search, or other controllers also read a catalog, create one
store for that application scope:

```ts
import { createRecordStore } from '@enbox/react/config';

const notes = createRecordStore((signal) =>
  enbox.using(NotesProtocol).records.observe('note', {
    materialize: true,
    pagination: { limit: 20 },
    signal,
  }), { signal: workspaceLifetime.signal });

const stop = notes.subscribe(() => updateIndex(notes.getSnapshot().records));
await notes.ready();
```

React consumers use `useRecords(notes)` or `useRecordView(notes)`. Both preserve
additional snapshot fields such as a selected store’s `selection`. Custom stores
should include shared metadata in both live and server snapshots; otherwise the
result type reflects its absence during server rendering. They share
the controller's view and pagination. Unmounting one consumer leaves the
store available to the others. No provider is required for a supplied store.
A count-only component can subscribe to the same owner with
`useObservableStore(notes, 0, (state) => state.records.length)`; it rerenders
when the selected count changes without opening another view.

Construction is inert. The first subscriber, `ready()`, or `retry()` starts
the view, which stays open until the owner calls `notes.close()` or its lifetime signal
aborts. Release controller subscriptions with `stop()` when retiring them.

For headless startup, `await notes.retry()` starts and attaches the view without
a temporary subscription or waiting for usable rows. Use `await notes.ready()`
when startup needs the rows themselves. Concurrent calls during opening share
that attempt. The same startup controls apply to `createContextStore` catalogs.

The protocol overload `useRecords(NotesProtocol, 'note', options)` and the
opener overload `useRecordView(opener)` own a view for each hook instead.

For a controller that changes its record selection, the same factory can own
the replacement views and expose the selection in each snapshot:

```ts
const notesByLimit = createRecordStore({
  selection: null as number | null,
  open: (limit, signal) => enbox.using(NotesProtocol).records.observe('note', {
    materialize: true, pagination: { limit }, signal,
  }),
  signal: workspaceLifetime.signal,
});

await notesByLimit.select(20);
const { selection: limit, records } = notesByLimit.getSnapshot();
```

`select()` resolves after attaching the native view; `ready()` waits for usable
rows. Selecting `null` releases it and publishes idle with no records. React
and controller subscribers keep one stable store and share its current view.
`updateRecords()` can publish an acknowledged local write before its native
query event arrives; the next native publication replaces that transient data.
Set `loadAll: true` on either factory form to expand every page for each opened
view. Expansion uses the same pagination controls and publishes failures in the
store snapshot; its lifetime follows the selected view.

## Observe memberships and invitations

Native membership and invitation observers also return `RecordView` instances.
Use `useRecordView` with a memoized opener to manage their opening, errors,
retry, and cleanup. For an owned page context:

```tsx
import { useMemo } from 'react';
import { useRecordView } from '@enbox/react';

const openMembers = useMemo(() => page == null ? null
  : (signal: AbortSignal) => page.members().observe({ signal }), [page]);
const members = useRecordView(openMembers);
```

Keep member projections and access-change policies in your application.
For an already-opened view owned by an application controller, use
`useObservableStore(view, fallback)` to borrow its snapshot and subscription.
This also works for native context catalogs, whose snapshots contain
`contexts` rather than `records`.

## Own context catalogs

`useContextView(opener)` manages the asynchronous lifetime of a native
`ContextView`. Its result preserves native `contexts`, `status`, and `error`,
adds `idle` for a disabled selection, and provides `retry()`.

```tsx
const protocol = useProtocol(NotebookProtocol);
const openContexts = useMemo(() => protocol === undefined ? null
  : (signal: AbortSignal) => protocol.contexts.observe({
      access: 'member', materializeRoot: true, signal,
    }), [protocol]);
const catalog = useContextView(openContexts);
```

For controllers and React consumers sharing a catalog, use
`createContextStore(opener, { signal })` from `@enbox/react/config`, then
`useContextView(store)` or `useObservableStore(store, fallback)`. The store has
`ready()`, `retry()`, and `close()` with the same owner-lifetime contract as
`createRecordStore`. Context catalogs have no pagination or replication
`current` flag; individual materialized roots retain their native record state.

## Mutations

Mutation runners check the rendered facade and session before executing and
reject obsolete bindings. Each invocation has its own Promise. `pendingCount`
counts current work, the latest invocation owns the displayed error, and
`reset()` clears that error without cancelling writes. `run` is the
compatibility alias for `mutateAsync`.
Issued operations can finish after replacement or unmount. Guard caller-side work after `await`
against session or context changes; the library cannot undo a completed write.
Use the captured mutation's `isCurrent()` before UI effects after `await` to
check that its connection binding and subscription lifetime are still active.
Old guards stay retired after Activity hides and restores the same component.
Pass `{ scope: pageId }` when the mutation also belongs to a page or dialog. Changing that scope resets
pending/error presentation and retires captured controls while issued writes
retain their original Promise outcomes. Use a stable scope key, such as a
record ID; a new object reference creates a new scope. Scope changes retire
presentation rather than queueing calls; concurrent invocations remain parallel.

`pendingVariables` lists each current invocation's input in start order,
including concurrent calls with identical inputs. Derive per-row busy state
from those inputs rather than maintaining another pending set:

```tsx
const update = useEnboxMutation(
  async (enbox, input: { recordId: string; title: string }) =>
    enbox.using(NotesProtocol).records.patch('note', input.recordId, { title: input.title }),
  { scope: activeList },
);
const isBusy = (recordId: string) =>
  update.pendingVariables.some((input) => input.recordId === recordId);
```

The mutation runner captures the operation passed by that render. Its identity
is stable while that operation and session binding are stable; use
`useCallback` for the operation when a consumer needs a stable runner. This
also keeps an abandoned render from replacing a committed callback.

## Connection and advanced bindings

| Hook | Contract |
| --- | --- |
| `useConnection(selector?, isEqual?)` | Native connection snapshot or a selected slice. |
| `useConnectionActions()` | Stable native actions, including `connectVault`, initialization retry, and remote recovery. Flow errors resolve in snapshots. |
| `useEnboxClient()` | Borrowed native connection store. |
| `useEnbox()` | Published facade, including a valid retained repair session. |
| `useIdentity()` | Current session identity metadata. |
| `useSyncStatus()` | Native sync snapshot. |
| `useProtocol(protocol)` | Typed facade binding, recreated when the facade changes. |
| `useObservableStore(store, fallback, selector?, isEqual?)` | Borrow an observable; select and compare a slice without a caller-maintained result cache. |
| `useRecordView(opener)` | Owns a view opened by a memoized callback receiving an abort signal; `null` releases it. |
| `useContextView(opener)` | Owns a native context catalog, or borrows a shared context store; `null` releases the selection. |

`useConnectionActions` is an advanced native binding. Its connect/disconnect
actions return raw snapshots and bypass the provider's application guards and
workflow presentation. Use `useEnboxConnection` for guarded React UI actions.

The [architecture](https://github.com/enboxorg/enbox-react/blob/main/docs/architecture.md)
describes connection bindings, resource ownership, query identity, and async
operation contracts.

With a selector, `fallback` is the selected value returned for an absent store
and during server rendering. The selector runs only on actual store snapshots;
`isEqual` defaults to `Object.is`. Mutable sources must publish a changing,
cached snapshot (such as a revision number) when their contents change.

## Validation

```sh
bun run check
bun run test:browser
```

`check` builds ESM and declarations, checks positive/negative type contracts,
and runs lifecycle, query, mutation, hydration, package-export, generator,
and real local DWN tests. The browser check generates an app from the packed
CLI, installs the packed SDK, and checks its types, production build, worker,
offline shell, and controlled connected UI. Install Chromium with
`bunx --no-install playwright install chromium` if it is not already available.

The automated tests do not perform wallet approval on a real account. The
starter provides that flow for manual integration testing. See
[testing](https://github.com/enboxorg/enbox-react/blob/main/docs/testing.md)
for automated coverage and integration boundaries.
