# Architecture

`@enbox/react` adapts Enbox's connection store and observable record views to
React. Authentication, protocol installation, encryption, persistence, and
replication run in `@enbox/browser`.

## Package entrypoints

| Entrypoint | Contents |
| --- | --- |
| `@enbox/react` | Provider, hooks, result types, and binding errors. Includes the React client directive. |
| `@enbox/react/config` | Client factory, protocol/manifest authoring exports, and their types. Construction works without browser globals. |

`src/config` contains configuration, `src/hooks` contains React adapters, and
`src/internal` contains subscription and asynchronous-operation state. Only
exports listed in `src/index.ts` and `src/config/index.ts` are public.

## Client and view lifetimes

`EnboxProvider config={options}` creates one native client for its mounted
scope. The internal `ConfiguredProvider` manages its initialization and disposal.
Construction is inert; initialization happens after mount. Disposal
is deferred past Strict Mode replay. Retained UI can resume Effects after
retirement, so the provider replaces a disposed client before initializing
the resumed scope. Configuration is fixed for that scope.

`EnboxProvider client={store}` uses an existing client through the internal
`ExistingClientProvider`. It calls the client's idempotent `initialize()` after
mount unless `initializeOnMount` is false.
Initialization restores a session; wallet approval starts through an action.

The application manages the existing client's lifetime and calls
`client.dispose()` when retiring it, or `disconnect()` to sign out. Hook
subscriptions are released when their consumers unmount or React deactivates
those consumers.

`useObservableStore` borrows a synchronous observable and never closes it.
The opener and protocol overloads of `useRecordView` and `useRecords` own
their views. Each has independent pagination state and a view lifetime.
Both hooks also borrow a `RecordStore` created with `createRecordStore`.
Borrowed pagination captures the rendered selection’s retry identity, so a
retained action cannot expand a different selection or a later reuse of its key.
Such a store is shared with headless controllers; its owner closes it or
aborts its scope signal. The first subscriber, readiness waiter, or explicit
`retry()` starts the view, and consumer unsubscription does not retire it. Supplied stores carry
their own scope and need no provider.

An owner can start either shared-store factory with `retry()` and await native
view attachment without waiting for usable data. This does not reactivate an
unsubscribed hook-owned view or reopen a closed, disabled, or aborted owner.

`useContextView` and `createContextStore` apply the same ownership rules to
native context catalogs. Both adapters share the internal view observer;
record pagination stays in the record adapter. Context results preserve the
native `contexts` state without adding record-only freshness or pagination.

## Connection bindings

`useEnboxConnection` combines native snapshots with a provider-scoped workflow
controller. Wallet `connect`, local `connectVault`, and `disconnect` use this
same workflow, including usable-session flags, errors, and shared progress.
The connect methods share one pending operation. `beforeConnect` receives an
action-discriminated context with the matching options and the current native
snapshot. Guards run outside native authentication and are followed by a
facade/session check, so delayed guards cannot sign out or replace another
identity. Disconnect also supersedes either connect method waiting on a guard.

`useConnection` exposes native session and recovery data. Password acquisition
and recovery-phrase UI stay application-owned. The advanced
`useConnectionActions` hook binds native methods, including `connectVault`,
without the provider's application guards or presentation workflow; their raw
snapshot outcomes retain the native contract.

Subscription cleanup detaches its own handles and presentation before calling
native cleanup, which can synchronously subscribe again. Mutation cleanup also retires its old
presentation first, so it cannot erase work started by a replacement subscriber.

## Profile resources

Profile observers are inert during render. Their first subscription retains a
shared native reader for the source and image policy and watches the selected
DIDs. Each result exposes resolved display fields and native status/failure metadata.
Observers select eager, lazy, or off image policy. Native off readers serve
text-only and unrequested lazy consumers. Native eager readers serve eager
consumers and explicitly requested lazy DIDs. Separating these pools prevents
native image demand left by earlier consumers from affecting a later text
lookup. Requests coalesce within each pool. Lazy activation may read the root
again; already usable text is retained while it settles. Text-only observers
acquire no image leases and their image fields stay idle. Aggregate status and
field metadata describe the reader selected for that DID.
Image leases are reused by Blob identity and released with a grace period for
DOM consumers.
The last observer releases the reader after Strict Mode replay. A retained
observer can reacquire a reader after retirement; callbacks from earlier watch
generations cannot publish into the resumed observer.

Initial synchronous watch emissions are batched into one complete selection.
Native immutable snapshot identity avoids rebuilding unchanged DID results.
Metadata changes publish a new result without replacing unchanged image leases.

## Rendered authorization

A connection binding contains the exact Enbox facade and authorization-session
references read by a render. The client is a separate identity dependency.
An unchanged DID does not imply an unchanged session or facade.

Connection selectors use `useSyncExternalStoreWithSelector`. Snapshot reads
are synchronous and cached by the native store. `Object.is` is the default
selection comparison; callers supply equality for object projections.

Record controls and mutation runners check their binding against the current
client snapshot, including the session's abort signal. An obsolete control
rejects with `EnboxBindingChangedError`. Mutations without a connection reject
with `EnboxNotConnectedError`.

The checks use the published facade rather than the connection phase alone.
A repair can temporarily report `connecting` while retaining a usable facade.
Sync-only snapshot updates keep the same binding and do not reopen views.

## Record views

A view observer is inert during construction and rendering. Its first
subscriber starts an opening attempt; its last subscriber cancels that
attempt and releases the view. A later subscription starts a fresh attempt.
This supports Strict Mode replay and React Activity without retaining closed
resources.

Shared stores use the same observer with an owner lifetime. `ready()` waits
for usable rows and allows independent waiter cancellation. Owner `close()`
is terminal, publishes idle, and waits for cleanup of acquired views. A late
opening is closed when it resolves. An owner signal invalidates the store
immediately, including reads and controls from retained React results.

Each attempt has an abort controller, an opening Promise, and any attached
view, subscription, or pagination Promise. Replacing an attempt registers its
successor before running cleanup, so a retry requested during cleanup joins
the replacement. Opening starts in a microtask and checks that its attempt is
still current before calling the opener.

After a view resolves, the observer subscribes before reading its snapshot.
It checks the attempt again after both operations. This closes the gap between
opening and attaching, and prevents a listener returned after retirement from
remaining attached. A late opening closes its returned view.

Cleanup invalidates the attempt, detaches listeners, aborts the signal, and
closes the view. Cleanup errors are reported through
`console.warn('[@enbox/react] Resource cleanup failed.', cause)`.

| State/control | Meaning |
| --- | --- |
| `idle` | No enabled view or current binding. Records are empty. |
| `loading` | An enabled selection is opening. |
| `ready` | Local rows are usable. |
| `error` | Opening, observation, or pagination failed. Pagination errors retain usable rows. |
| `current` | Native replication freshness; independent of whether saved rows are usable. |
| `retry()` | Reopens the original selection and page limit. Concurrent opening calls share a Promise. Opening failures reject and also appear in state. |
| `loadMore()` | Expands the retained prefix. Concurrent page calls share a Promise. Failures reject and also appear in state. |

Automatic opening publishes errors in state and handles its own rejection.
An explicit control returns its Promise to the caller. Cleanup does not
replace the result of an already-issued operation.

## Query identity and types

`useRecords` includes `from`, `within`, `protocolRole`, `filter`, `dateSort`,
`pagination`, and `materialize` in its serialized query. Object keys are
sorted, undefined object fields are omitted, and array order is preserved.
Equivalent inline options retain the view. Serialization rejects cycles,
accessors, sparse arrays, symbol keys, and unsupported non-JSON values.

Client, session, facade, protocol object, and path identities remain separate
from serialized values. Protocols and codec objects should be stable
application constants. The opener owns a parsed copy of the query, so later
caller mutations cannot alter an opening request. `enabled` controls the
React lifetime, and the hook owns the abort signal; neither is a query key.

A positive safe-integer `pagination.limit` bounds retained rows. The native
SDK validates the query. Nested paths require an exact `within` context ID.
Without materialization, rows are native typed record handles. With
`materialize: true`, rows contain the handle and decoded value. Object
materialization preserves the SDK's selected direct singleton children and
infers each child's codec. Singleton eligibility derives from the native `set`
contract. An ID-free `useEnboxRecord` selection also checks the singleton
schema fact at runtime; malformed JavaScript IDs cannot turn into an unfiltered selection.
Codecs provide TypeScript inference; a codec validator provides
runtime payload validation.

## Mutations

`useEnboxMutation` invokes the supplied operation once through the rendered
connection. The runner captures that render's operation, so an abandoned
render cannot replace the callback of committed UI. Its function identity is
stable when the operation and binding are stable.

The observer counts all pending calls in its active lifetime. The latest
invocation owns the displayed error; earlier calls still settle their own
Promises. `reset()` clears the error and prevents older failures from
repopulating it while preserving pending work. Cleanup advances the lifetime,
so previous completions cannot change a reopened observer's state.

A pending-state subscriber can synchronously change the binding. The runner
therefore checks again after publishing pending state and before invoking the
operation. Unknown rejection values are converted safely for display, while
the invocation's Promise preserves the original rejection.

Issued writes can complete after replacement or unmount. Application code
must guard its own work after `await`, including draft clearing or navigation,
against changes to the session, selected context, and component lifetime.
The captured mutation's `isCurrent()` checks that its observer and connection
binding are currently active before those UI effects. A guard captured before
unsubscription stays retired after Activity resumes the same observer.
An explicit `{ scope: pageId }` retires captured controls when the scope changes. Draft versions and other
application state still need application checks.

## Server rendering and browser startup

Server rendering and initial hydration use an initializing connection and
idle record snapshots. They restore no session and open no storage. After
mount, consumers read the browser store. `useObservableStore` uses its
caller-provided fallback as the server snapshot.

Create fresh inert clients for server renders and retain one client in the
browser. Keep stores and codec-bearing manifests inside the application's
client boundary; they cannot be serialized as server-component props.

The standalone starter calls the native `prepareBrowser` helper with its own
worker URL and registration scope. This waits for worker control before rendering
the provider. The browser SDK activates worker updates automatically. Apps
requiring deferred activation must account for that behavior when protecting
unsaved edits.

## Local record commands

`useEnboxRecords` and `useEnboxRecord` compose existing query and mutation hooks.
They own no additional cache or native record lifetime. Collections materialize
payloads; singleton reads use a one-row native view. A specific-ID selection
cannot call `set`. Role paths and remote/role query options are excluded from
these convenience APIs; lower-level hooks retain those native capabilities.

Command identity includes protocol, path, parent context, and active selection;
query filters and pagination remain read-only concerns. Record-specific
patch/delete also capture the selected ID. Singleton set captures the logical
path/context so the first occupant appearing does not retire its command.
Convenience selections require the direct parent depth before opening a view,
so a singleton cannot silently select one descendant below an ancestor context.
Native patch is path-bound, so nested patch/delete first read immutable context
metadata and reject a different direct parent. The native SDK retains missing
record, encryption, validation, authorization, and conflict behavior.

`mutate` handles its returned rejection after state has recorded the error;
`mutateAsync` and existing `run` preserve the native outcome when no success
handler is supplied. Convenience query
controls similarly mark their returned Promise handled without changing what
an awaiting caller receives. These hooks add no mutation retries or optimistic rows. Ordinary domain hook modules fix protocol paths and scopes;
they are normal static React hooks rather than dynamically generated hooks.

Success handlers are per invocation and run through the existing mutation
observer, keeping pending/error presentation in one place. They start only after
native success and only while that invocation's subscription generation and
binding remain current. They are awaited; a handler failure can reject the
mutation after the native write has committed. A retired handler is skipped
without replacing the issued write's outcome. Async handler bodies still own
checks after their own further awaits.

Context hooks return the owner's snapshot and retry control directly, preserving
owner metadata and captured-selection semantics. Domain hooks share logic;
shared views use explicit owner stores. Selectors read those stores without
another native observer. CI builds declarations once in `check`; consumer
scripts use those same outputs. Standalone public consumer commands still build
before packing.

Borrowed view overloads preserve both live and server snapshot types. A field
available only on a live custom snapshot is not promised during SSR/hydration.
Owner stores that expose selection metadata in both snapshots retain that field.
The record hook adds its own pagination control, replacing a same-named custom
snapshot field in both the runtime result and its type.
