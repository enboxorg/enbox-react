# Testing

Run `bun run check` for the library, type contracts, configuration files, and
built-package tests. Run `bun run test:react18` to validate the installed
archive with React 18.3.1; the authoring suite uses React 19.3.0. Run
`bun run test:browser` for the production Notes example.
See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup and dependency
changes.

## Test boundaries

| Suite | Verifies |
| --- | --- |
| Connection | Provider borrowing, initialization, stable actions, selective rerenders, custom equality, and selector changes. |
| Observable store | Borrowed subscription ownership, store replacement, fallback values, receiver binding, and changes during subscription attachment. |
| Record views | Opening/retry failures, cleanup, late completions, subscription gaps, pagination, reentrant controls, disabled views, Strict Mode, and Activity. |
| Records | Query-value identity, materialization controls, disabling, client replacement, and immediate session guards. |
| Mutations | Missing/obsolete connections, aborts, pending counts, out-of-order failures, reset, original rejections, and lifetime replacement. |
| Concurrent rendering | Suspended selections open no resources and do not replace committed mutation callbacks. |
| SSR | Matching server/hydration shells and activation only after mount. |
| Query serialization | Deterministic values, shared acyclic objects, and rejection of unsupported or effectful values. |
| Native SDK integration | Encrypted local creates, patches, deletes, live record updates, and prefix pagination through a real SDK view. |
| Public types | Built declarations preserve decoded values, mutation variables, exact paths, nested contexts, filters, and configuration constraints. |
| Package exports | Built JavaScript/declaration targets exist, client directives are preserved, and public modules import without browser globals. |
| Browser | Production service-worker control, successful startup, no page errors, and offline shell reload. |

## Fixtures and cleanup

React tests use controlled connection stores and views at the SDK boundary.
They deliberately leave wallet approval, encryption, and query execution to
the native SDK integration suite. Keep snapshots reference-stable until
publication and return a fresh view for each open operation.

The native integration test uses `@enbox/api/testing` in a Node environment.
Crypto and byte-array values must stay in the same JavaScript realm. The DOM
suites use jsdom and test React subscriptions independently.

React Testing Library cleans up rendered hooks after each test. Tests that
subscribe to observers directly use `subscribeObserver` to register cleanup
even when an assertion fails. Native test contexts close in `finally` blocks.

For asynchronous regressions, control the actual boundary with deferred
Promises or explicit publication. Verify that an opening has started before
testing a late completion. Assert resource ownership, observable results, and
original rejection values rather than incidental effect counts or timings.
Expected cleanup diagnostics should be asserted; unexpected rejected Promises
must fail the test run.

## Public package checks

`type-tests/contracts.tsx` resolves `@enbox/react` through `package.json`
exports and the built declarations. Invalid calls use `@ts-expect-error`, so
widening an API until an invalid input compiles fails the check.

`tests/package/exports.test.mjs` uses the native Node module resolver against
the built public entrypoints. The build clears generated output first, which
prevents deleted or renamed modules from remaining in a packed release.

Before a release, inspect `npm pack --dry-run` and test the resulting archive
in a consumer. This confirms file inclusion as well as local export
resolution.

## Integration coverage

The browser suite runs without approving a real wallet account. Wallet
approval and delegated remote replication need separate integration runs.
Plain SSR is covered; a framework-specific server-component application is
not part of the automated fixtures. Offline testing verifies the application
shell, not a remote write queue or shared-context editing behavior.

## React compatibility

The React 18 consumer fixture installs the packed SDK with its own renderer
and React declarations. It runs the same applicable regression cases and
public type contracts; React Activity is exercised only by the React 19 suite.
The generated consumer lives in `.artifacts`, and all registry dependencies
are frozen by the fixture's committed lockfile. Only the local SDK archive
checksum is refreshed as its source changes.
