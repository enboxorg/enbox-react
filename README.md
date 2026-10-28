# @enbox/react

Client-side React bindings for Enbox application stores, wallet connections, and profiles.
Feature observations and commands live in the SDK and work with React and
headless application code. React reads the same cached state through `useStore`.

The canonical starter lives in `packages/create-dapp/template`. It uses the same
feature structure as notesd: application setup, protocol definitions, feature
stores, and components. Generate an app with:

```sh
npm create @enbox/dapp@latest
```

## Application and feature stores

Declare typed protocols and feature stores with `@enbox/browser` in browser apps,
or `@enbox/api` in other environments:

```ts
import { defineProtocol, defineStore, recordCodecs } from '@enbox/browser';

const NotesProtocol = defineProtocol({
  protocol: 'https://example.com/notes/v1',
  published: false,
  types: { note: { dataFormats: ['application/json'], encryptionRequired: true } },
  structure: { note: {} },
} as const, { note: recordCodecs.json<{ title: string }>() });

export const NotesStore = defineStore({
  protocols: { notes: NotesProtocol },
  create({ protocols }) {
    const notes = protocols.notes.collection('note');
    return {
      notes,
      add: (title: string) => notes.create.run({ title: title.trim() }),
    };
  },
});
```

Input helpers reuse collection commands and their progress state. The feature's
`command` factory gives a domain operation its own shared progress when needed,
such as coordinating several writes.

Create one application outside React. Its manifest comes from the registered
features and their dependencies. Browser setup supplies the wallet handler and
retains the configured wallet identity for per-call wallet overrides:

```ts
import { createApplication } from '@enbox/browser';
import { NotesStore } from './features/notes/store.js';

export const application = createApplication({
  stores: { notes: NotesStore },
  wallet: { appName: 'Notes', applicationId: 'notes-app' },
});
```

Pass the application to the provider after any required worker setup:

```tsx
import { EnboxProvider, useEnboxConnection, useFeature, useStore } from '@enbox/react';

function Notes() {
  const connection = useEnboxConnection();
  const feature = useFeature(NotesStore);
  const notes = useStore(feature.notes);
  const progress = useStore(feature.notes.create);
  if (!connection.isConnected) return <>
    <button disabled={connection.isConnecting}
      onClick={() => { void connection.connect().catch(() => {}); }}>
      Connect wallet
    </button>
    {connection.connectionError && <p role="alert">{connection.connectionError.message}</p>}
  </>;
  return <>
    <button disabled={progress.pendingCount > 0}
      onClick={() => { void feature.add('New note').catch(() => {}); }}>
      Add note
    </button>
    {progress.error && <p role="alert">{progress.error.message}</p>}
    <ul>{(notes.records ?? []).map(({ record, value }) =>
      <li key={record.id}>{value.title}</li>)}</ul>
  </>;
}

root.render(<EnboxProvider application={application}><Notes /></EnboxProvider>);
```

The provider initializes the borrowed application after mount. Set
`initializeOnMount={false}` when the host starts it explicitly. Unmounting React
releases subscriptions and connection UI; the application owner calls
`await application.dispose()` at the end of its lifetime.

`useFeature` follows session/facade replacement. Constructors and snapshot reads
open no native views. Store subscriptions keep observations active; the last
consumer releases its observation unless a headless owner still retains it.

## Shared observations

`observe(...)` declares a shared observable store for a native view. Creating it
is inert; subscriptions or headless controls activate observation. Protocol
collections use this same implementation and add scoped write commands.
An `ObservedStore` preserves its native typed data, such as records or contexts.

The task starter declares an observation whose input selects a scoped collection:

```ts
create({ protocols, observe }) {
  const tasks = protocols.board.collection('project/task');
  const activeTasks = observe({
    source: (parent: string) => tasks.within(parent),
  });
  return {
    tasks,
    activeTasks,
  };
}
```

The observation starts idle with a null selection. The published selection and
data change together. Selecting keeps a borrowed
query live until another selection, `null`, close, or owner retirement. Other
features can declare independent observations without changing the family's
canonical handles. Commands stay on `tasks.within(parent)`.

Observed stores expose readiness, retry, and supported native controls. Record
pagination progress is part of their state as `isLoadingMore`; components do
not need commands solely to track a read control. A headless consumer explicitly
retains an observation when it needs continued updates:

```ts
const notes = application.store(NotesStore).notes;
const release = notes.retain();
try {
  const state = await notes.ready();
  // Read state.records or subscribe for later publications.
} finally {
  release();
}
```

Advanced native operations remain available through `protocols.notes.native()`
inside an observation opener or command. The native client retains the SDK's full
query, singleton, file, metadata, context, and sharing contracts. Resolve it when
performing work instead of caching it across authorization changes.

## Reading stores

`useStore(source)` reads any source with `getSnapshot` and `subscribe`. Select a
slice with an optional equality function:

```tsx
const count = useStore(feature.notes, {
  selector: (state) => state.records?.length ?? 0,
});
const selected = useStore(feature.notes, {
  selector: (state) => ({ count: state.records?.length ?? 0 }),
  isEqual: (previous, next) => previous.count === next.count,
});
```

Nullable sources use the same hook with an explicit fallback:

```tsx
const notices = useStore(workspace?.notices, { fallback: EMPTY_NOTICES });
const title = useStore(workspace?.document, {
  fallback: 'Untitled',
  selector: (document) => document.title,
});
```

A fallback is already selected: absent sources return it without calling the
selector. Keep fallback values reference-stable.
A legitimate `undefined` snapshot remains a real value. Store methods retain
their receiver, and unmount releases only React's subscription.

Snapshots are cached published state values; reading them does not make a copy.
Selectors use `Object.is` unless `isEqual` is supplied. Rendering does not start
observations or acquire leases.

## Commands and UI completion

Commands share pending inputs and error state across consumers and preserve their
original result or rejection. `isCurrent()` checks authorization, not a component's
lifetime, draft, or navigation target. Keep those product choices in the caller.
For example, an older delete completion must not clear a newly opened selection:

```ts
const target = selection;
await feature.notes.delete.run(target.id);
if (feature.notes.delete.isCurrent()) {
  setSelection((current) => current === target ? undefined : current);
}
```

The starter keeps task-detail drafts in React, reuses loaded list records, and
opens a bounded selected-record observation when the record lies outside the
loaded window. It distinguishes a ready empty result from a lookup failure.

## Connection and profiles

`useEnboxConnection()` exposes guarded wallet/vault actions and shared connection
presentation: pending state, identity, wallet repair, sync/remote status, and
errors. Actions reject actionable failures; cancelled wallet approval stays quiet.
Provider `beforeConnect` and `beforeDisconnect` guards can await application work
before native authentication changes. A failed guard leaves the session intact.
An explicit discard action can use `disconnect({ skipBeforeDisconnect: true })`.
Native advanced actions are available through `useApplication().connection` and
retain their native snapshot-returning contracts.

`useProfile(source, did, options?)` and `useProfiles(source, dids, options?)` read
public profiles independently of a provider. They expose per-field settlement
metadata and leased image URLs. Image modes are `eager` (default), `lazy` with
`loadImages()`, and `off`. Missing names and unavailable images remain display
choices for the component.

## React API

| Export | Purpose |
| --- | --- |
| `EnboxProvider` | Borrow an application and initialize it after mount. |
| `useApplication` | Access the shared headless runtime and native connection. |
| `useFeature` | Resolve a session-owned feature and follow its replacement. |
| `useStore` | Read an observed store, command, or plain observable store. |
| `useEnboxConnection` | Guarded connection actions and UI presentation. |
| `useProfile`, `useProfiles` | Public profile state and browser image presentation. |

SDK authoring and native operations come from `@enbox/browser` or `@enbox/api`.
See [architecture](docs/architecture.md), [testing](docs/testing.md), and
[contributing](CONTRIBUTING.md) for implementation boundaries and verification.
