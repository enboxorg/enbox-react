# Enbox React

React bindings for Enbox connections, typed live records, and session-bound
mutations. The package uses `@enbox/browser`'s connection store and observable
APIs.

## Run locally

```sh
bun install --frozen-lockfile
bun run check
bun run example:dev
```

The example uses the package's built exports, so run `bun run build` after
changing library code. It registers its application-owned worker before
rendering or initializing Enbox. The browser SDK automatically activates
updated workers.

Runtime and development dependencies use exact versions; peers accept only
the explicitly tested releases. Bun defaults to exact saves, frozen lockfile
installs, and no automatic runtime installs;
npm also saves exact versions. The current peer pins are `@enbox/browser`
`0.3.79` and React `18.3.1` or `19.3.0`. Development setup and intentional
version changes are documented in
[CONTRIBUTING.md](https://github.com/enboxorg/enbox-react/blob/main/CONTRIBUTING.md).

## Define the application

`@enbox/react/config` contains ordinary SDK authoring exports and an inert
client factory. It has no React client directive.

```ts
import {
  createEnboxClient,
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

export const client = createEnboxClient({
  application: defineApplicationManifest({ protocols: [NotesProtocol] }),
  wallet: { appName: 'My notes', appIcon: '/icon.svg' },
});
```

Protocol identifiers should be stable URLs owned by your application.
`recordCodecs.json<T>()` provides type inference; pass a standalone `validator`
for runtime validation. The example demonstrates a small domain validator.

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
import { client } from './application.js';

export function App() {
  return <EnboxProvider client={client}><Notes /></EnboxProvider>;
}
```

The provider initializes the store after mount and borrows its lifetime.
Unmounting cleans up hook resources. The application host calls
`client.dispose()` when retiring the client; `disconnect()` signs out.
`initializeOnMount={false}` lets a host finish worker bootstrap before calling
`client.initialize()` itself.

For SSR, the initial shell is deterministic and contains no session. Create
the store within the client application boundary, use fresh inert instances
on the server, and retain a browser instance for the application lifetime.
Pass client components through your framework's client boundary; store
instances and codec-bearing manifests are not serializable RSC props.

## Read and write records

```tsx
import { useEnboxMutation, useRecords } from '@enbox/react';
import { NotesProtocol } from './application.js';

export function Notes() {
  const notes = useRecords(NotesProtocol, 'note', {
    materialize: true,
    pagination: { limit: 20 },
  });
  const create = useEnboxMutation(async (enbox, data: { title: string }) =>
    enbox.using(NotesProtocol).records.create('note', { data }));

  return (
    <>
      <button
        disabled={notes.status === 'idle' || create.isPending}
        onClick={() => { void create.run({ title: 'Hello' }).catch(() => {}); }}
      >Add note</button>
      {create.error && <p role="alert">{create.error.message}</p>}
      {notes.error && <p role="alert">{notes.error.message}</p>}
      <ul>{notes.records.map(({ record, value }) => <li key={record.id}>{value.title}</li>)}</ul>
    </>
  );
}
```

Paths, filters, decoded values, and mutation variables remain inferred.
Nested views require `within`, using the parent's exact context ID. Inline
query objects with equal contents keep the same view.

Without `materialize: true`, rows are native record handles and their payloads
remain lazy. A positive `pagination.limit` is required. `loadMore()` expands
the retained prefix; `retry()` reopens the original selection and page limit.
Both controls return Promises that reject on failure and also publish errors
in the result. Concurrent opening or pagination calls share their Promise.
Pass `null` options or `enabled: false` to release a view and return idle.

`ready` means local rows are usable. `current` reports replication freshness;
it can be false while useful saved data remains visible. The SDK drives live
changes without a polling or cache-invalidation loop.

Mutation runners check the rendered facade and session before executing and
reject obsolete bindings. Each invocation has its own Promise. `pendingCount`
counts current work, the latest invocation owns the displayed error, and
`reset()` clears that error without cancelling writes. Issued operations can
finish after replacement or unmount. Guard caller-side work after `await`
against session or context changes; the library cannot undo a completed write.

The mutation runner captures the operation passed by that render. Its identity
is stable while that operation and session binding are stable; use
`useCallback` for the operation when a consumer needs a stable runner. This
also keeps an abandoned render from replacing a committed callback.

## Connection and advanced bindings

| Hook | Contract |
| --- | --- |
| `useConnection(selector?, isEqual?)` | Native connection snapshot or a selected slice. |
| `useConnectionActions()` | Stable native actions, including initialization retry and remote recovery. Flow errors resolve in snapshots. |
| `useEnboxClient()` | Borrowed native connection store. |
| `useEnbox()` | Published facade, including a valid retained repair session. |
| `useIdentity()` | Current session identity metadata. |
| `useSyncStatus()` | Native sync snapshot. |
| `useProtocol(protocol)` | Typed facade binding, recreated when the facade changes. |
| `useObservableStore(store, fallback)` | Borrowed observable with a stable immutable server/empty fallback. |
| `useRecordView(opener)` | Owns a view opened by a memoized callback receiving an abort signal; `null` releases it. |

The [architecture](https://github.com/enboxorg/enbox-react/blob/main/docs/architecture.md)
describes connection bindings, resource ownership, query identity, and async
operation contracts.

## Validation

```sh
bun run check
bun run test:browser
```

`check` builds ESM and declarations, checks the example and positive/negative
type contracts, and runs lifecycle, query, mutation, hydration, package-export,
and real local DWN tests. The browser test builds the example and verifies a
controlling worker and offline shell reload with Chromium. Install that browser with
`bunx --no-install playwright install chromium` if it is not already available.

The automated tests do not perform wallet approval on a real account. The
example provides that flow for manual integration testing. See
[testing](https://github.com/enboxorg/enbox-react/blob/main/docs/testing.md)
for automated coverage and integration boundaries.
