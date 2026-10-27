# Architecture

The application runtime owns feature stores and their authorization lifetime.
The SDK owns resources, native views, query sharing, commands, and cleanup.
React borrows those objects and presents their cached state.

## Application setup

`createApplication` registers features, derives their protocol manifest, and owns
one native connection. Browser application setup adds wallet defaults and its
browser connect handler. Custom/native callers provide a connection factory that
receives the derived manifest. Application construction does not initialize the
connection; `initialize()` restores the session.

`EnboxProvider` accepts an application. It initializes after mount unless the host
opts out, and never disposes the supplied runtime. The host awaits `dispose()`
when the application ends. Connection UI policy stays in the provider so a dapp
can drain pending work before connect/disconnect without changing native actions.

## Features and resources

`defineStore` declares typed protocol and feature dependencies. Its factory runs
once per application authorization scope and returns inert handles synchronously.
The application closes them when their exact session or native facade changes.
Headless controllers and React obtain the same feature through
`application.store(definition)` and `useFeature(definition)`.

One SDK resource owner handles fixed native observations and keyed observations.
It owns asynchronous opening, cancellation, attachment, cached publications,
readiness, explicit leases, and cleanup. Protocol collection helpers supply typed
sources and commands through that same owner. Custom sources preserve native
record/context data and source-specific controls; React has no data-owner factory
or protocol query layer.

Subscriptions acquire observation interest. Headless owners use `retain()` when
an observation must continue without subscribers; readiness and controls use
bounded temporary interest. A selected resource owns its chosen source until
replacement, null, close, or scope retirement. Its selected input and data publish
atomically, and replacement acquires the new source before releasing the old one.
Canonical scoped collections remain shared with other consumers. Query handles
remain interned for the session lifetime; distinct descriptors can grow memory
until that scope ends. Descriptor eviction is separate work.

Native queries, remote roles, singleton slots, selected child materialization,
files, metadata, and context/sharing operations retain their SDK contracts.
Feature resources and commands call the full typed native client when a protocol
collection convenience does not express the needed operation. No second React
ownership model is needed for these sources.

## React subscriptions and SSR

`useStore` is the sole generic subscription hook. It reads cached snapshots,
subscribes after commit, and removes its listener during cleanup. It does not add
an extra retain lease, open a native view, close the source, or dispose the owner.
Strict Mode, Activity, and abandoned renders therefore use the same SDK ownership
rules as any other subscriber.

Sources may supply `getServerSnapshot`. A plain or nullable observable source
requires an explicit fallback. That fallback is the selected output and is never
passed to the selector; it serves absence and SSR when the source has no server
snapshot. Source-provided server snapshots take precedence. Undefined may be a
legitimate published value, so an internal sentinel distinguishes absence.

Snapshot means a cached published state value, not a fresh copy. Selectors receive
native live/server snapshots, equality defaults to `Object.is`, and store methods
retain their receiver. `useFeature` separately observes application invalidation
because session retirement can precede a connection publication.

## Commands and caller lifetimes

SDK commands own progress, pending inputs, reset, authorization checks, and
unchanged operation outcomes. React reads command state with `useStore` and calls
`run` for application work. Resources publish their own read-control progress,
including record pagination's `isLoadingMore`.

Authorization lifetime differs from an editor or navigation lifetime. Components
keep drafts and selection identity. After awaiting a command they check both
usable authorization and the relevant local target before applying an external
UI effect. An old completion cannot clear a newer selection, including a new
selection of the same record.

## Connection and profile presentation

The provider's connection controller retains guarded wallet/vault/disconnect
workflows, pending presentation, repair state, and error projection. It borrows the
application connection; raw native actions remain available on that runtime.
Browser setup retains wallet identity defaults for per-call wallet overrides.
Connection policy and product-specific drain/discard behavior are independent of
resource observation ownership.

Profile hooks retain their browser presentation responsibilities: native-reader
sharing, DID watches, per-field settlement, image policy, cached results, and Blob
URL leases. They accept explicit sources and work without a provider. Native
profile reads and Blob URL pooling already come from the SDK. These capabilities
are distinct from protocol collection ownership.

The create template and notesd follow this same feature/resource/command model.
Product navigation, drafts, document orchestration, notices, and display fallbacks
remain application code.
