# Testing

Run `bun run check` for the dependency audit, React regressions, public type
contracts, configuration, built-package checks, and generator tests. Run
`bun run test:react18` against the installed archive with React 18.3.1; development
uses React 19.3.0. `bun run test:browser` verifies a freshly generated app outside
this repository. See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup.

## Boundaries

| Suite | Verifies |
| --- | --- |
| Application/feature | Borrowed runtime ownership, explicit initialization, shared features, session replacement and early session abort. |
| Store | Cached reads, receiver binding, subscriber independence, nullable sources, selected fallbacks, selector/equality changes and subscription attachment updates. |
| Resource borrowing | Client mounting and initial state, SDK resource sharing through Strict Mode, Activity and suspended renders; React does not open resources during render or replace committed controls. |
| Connection | Guarded wallet/vault/disconnect, pending/error presentation, repair, drain failures, cancellation and retired workflows. |
| Profiles | Reader sharing, field settlement, image policies, source replacement, URL leases and retired callbacks. |
| Public types | SDK resource and command payloads, nullable/plain source contracts, selected fallbacks, equality and connection/profile options. |
| Package | Exactly the supported React exports, declarations/client directives, Node import safety and pinned dependencies. |
| Generator | Canonical template, JSON customization, destination guards, command output and failed-write cleanup. |
| Browser | Fresh standalone installs/builds, worker control/update/offline shell, encrypted native protocol fixture and connected task-board behavior. |

Native observation ownership lives in `@enbox/api`. Its resource tests own
asynchronous opening, reentrant cleanup, readiness cancellation, stale outcomes,
pagination, fixed/keyed resources and advanced native data contracts. React tests
exercise borrowing through the public SDK boundary. Native context, invitation,
role, singleton and child-materialization capabilities stay covered in the SDK;
removing React wrappers must not remove those native capabilities.

## Fixtures and cleanup

Controlled connection stores and views provide cached snapshots until an explicit
publication. Wallet approval, encryption and query execution remain native SDK
responsibilities. React Testing Library cleans up rendered hooks after each test;
application fixtures await disposal in `finally` blocks.

Control asynchronous regressions with deferred promises or publication. Verify an
opening started before testing a late completion. Assert ownership, visible state
and original rejection values rather than incidental effect counts. Expected
cleanup diagnostics are asserted and unexpected rejections fail the suite.

The React 18 fixture installs the packed library with its own renderer and type
declarations, then runs the applicable regressions and public type contracts.
Activity cases stay in `activity.spec.tsx`, which runs only with React 19. Registry
dependencies are fixed by the fixture lockfile; only the local archive checksum
changes when testing the package candidate.

## Package and generated apps

Package checks use Node's resolver against built exports. The build clears output
first so deleted modules cannot survive in an archive. Public type contracts
resolve the built declarations and use `@ts-expect-error` for invalid inputs.
All dependency audits fail on every reported advisory severity.

The template ships no lockfile. Browser checks independently generate npm and Bun
apps, install the packed React library, audit and build them, and verify frozen
reinstallation against their newly created lockfiles. Generator publication uses
`ENBOX_STARTER_SDK_SOURCE=registry` to require the actual released template pins.
Test fixtures are injected after the production build and never ship to users.

The encrypted protocol fixture checks projects, scoped tasks, completion/reopening,
read-by-ID and codec validation. Browser UI checks cover profile fallback, project
isolation, task CRUD, read/write retries, list/detail observer reuse, selection
outside a bounded window and disconnect during pending work. They preserve the
reopened-detail identity guard against an older delete completion.

Worker checks cover development/production control, updates, cache cleanup,
ordinary-worker separation and offline shell reload. This does not assert a remote
write queue or shared-document editing. Wallet approval, vault recovery UX and
remote delegated replication need application integration runs.

Browser tests have a five-minute global timeout so Playwright writes failure
reports before CI ends. Provisioning shares the job's fifteen-minute budget.
