# Contributing

## Setup and checks

Use the Node and Bun versions in `.node-version` and `.bun-version`.
Install dependencies with `bun install --frozen-lockfile`. Dependency versions
and the allowed peer releases are fixed. `bunfig.toml` disables automatic
runtime installation. The standalone starter ships no lockfile and uses
published SDK exports. Its isolated browser check installs the current packed
SDK instead. `starter:dev` also uses the local SDK archive without changing
the template manifest or generating a template lockfile.

| Command | Purpose |
| --- | --- |
| `bun run build` | Clear generated output and build ESM, declarations, and source maps. |
| `bun run typecheck` | Build public declarations and check source, type contracts, and tooling configuration. |
| `bun run test` | Run unit, React, and native local DWN tests. |
| `bun run test:react18` | Install the packed SDK and run consumer types and regressions with React 18.3.1. |
| `bun run test:package` | Build and verify public runtime exports and client boundaries. |
| `bun run audit` | Audit all locked runtime and development dependencies; every advisory fails the check. |
| `bun run check` | Run the dependency audit, type checks, unit/integration tests, and package checks. |
| `bun run test:generator` | Check the CLI's filesystem, metadata, and argument handling. |
| `bun run test:browser` | Pack the generator and SDK, create an isolated app, and check its install, types, build, and browser behavior. |
| `bun run starter:dev` | Build/install the local packed SDK and serve the canonical starter with Vite. |

Install Chromium with `bunx --no-install playwright install chromium` before
running browser tests if it is not available. See [testing](docs/testing.md)
for fixture boundaries and integration coverage.

## Code organization

Keep native authentication, protocol, persistence, and replication behavior
in Enbox. This package owns React subscriptions, rendered connection bindings,
view lifetimes, and presentation state. See [architecture](docs/architecture.md)
for those contracts.

The starter's parameterized domain hooks are the default application pattern.
Keep selected IDs and drafts in application state. Controllers use typed
CRUD through shared typed query owners. Live views propagate writes to React.
Use `useEnboxResource` for application services with session lifetimes and drain
barriers. Protocol, query, view, and mutation behavior reuse the native SDK and
existing observers; avoid parallel definitions, registries, and state engines.

Generic lifecycle and mutation regression tests belong here. Dapps retain
protocol/permission policy, domain rules, UI behavior, and focused wiring tests;
remove app tests that duplicate behavior delegated to this SDK.

Use explicit domain names, preserve native public types, and keep public
exports in the two entrypoint files. Prefix hooks with `use`. Distinguish a
connection binding from a record context: the first identifies the current
facade/session; `within` identifies a protocol context.

Use two-space indentation, explicit type imports, and `.js` specifiers for
local ESM imports. Break long signatures and JSX into readable lines. Use names
that describe a value's role, such as a native view, rendered snapshot, or
opening attempt.

Keep JSDoc focused on public contracts that signatures cannot express: when
resources start and stop, what a Promise waits for, or how errors are surfaced.
Use internal comments to explain ordering and lifetime checks. Omit comments
that repeat the code or describe each parameter without adding context.

Add regression tests for changes to resource ownership, session guards, or
async error handling. Run the relevant suite while developing, then run
`check`. Changes to startup, worker behavior, or the starter also need the
browser suite. Generated `dist` and test reports are not committed.
The repository workflow runs both check suites on pull requests and pushes
to `main`; its actions are pinned to immutable commits.

## Dependency changes

Keep `@enbox/browser` pinned and React peers limited to tested releases so
applications use their own SDK and React instances. `use-sync-external-store`
is the runtime dependency.
Root development dependencies support only SDK compilation and tests.

| Development dependencies | Use |
| --- | --- |
| `@enbox/api` | Native DWN integration fixtures through `@enbox/api/testing`. |
| `@enbox/browser` | Compile and test against the exact browser SDK declared as a peer. |
| `vitest`, `@testing-library/react`, `@testing-library/dom`, `jsdom` | Unit tests, React lifecycle tests, and the DOM environment. |
| `@playwright/test` | Production browser tests. |
| `typescript`, `@types/react`, `@types/use-sync-external-store` | Compilation, declarations, and type contracts. |
| `react-dom`, `@types/react-dom` | Renderer, SSR, and hydration tests. |
| `@types/node` | Node APIs in tests and tooling configuration. |

The single starter source lives in `packages/create-dapp/template`. Keep its
configuration independent of the repository root. Its exact dependency manifest
defines each new app; the user creates and commits their package manager’s
lockfile on first install. The generator customizes JSON metadata only; its
published archive includes this same template.
The starter owns its Vite, React Fast Refresh, TypeScript, and type dependencies.
Vite bundles the application worker; a scoped cache provides the offline shell.
The generator itself has no dependencies. Add packages where they are used,
and prefer existing platform or tool APIs when they cover the needed behavior.

Pin direct runtime and development dependencies to exact versions. Package
checks enforce this in all manifests; `.npmrc` and `bunfig.toml` also save exact
versions. Peer declarations describe compatibility, rather than pinning an
application's installation; this SDK currently lists the releases it tests.
Committed lockfiles fix transitive versions, and CI uses frozen installs.
Consumers use their own application lockfiles; they do not inherit this
repository's dependency tree when installing the published SDK.
Exact pins make updates deliberate, but do not establish that a release is
safe or automatically bring in security fixes. Review dependency updates and
their lockfile changes, including advisories, before accepting them.

`test:browser` creates temporary npm and Bun projects outside the repository.
It verifies that neither ships a lockfile, runs a fresh audited install and
build for each, then repeats a frozen install against the newly generated lock.
The app uses the current packed SDK so unpublished changes can be tested.
Test fixtures are added only after the production build and are never generated
for users. The separate React 18 consumer retains its committed frozen lockfile.

For an intentional dependency change, edit the exact version in
`package.json`, temporarily set `install.frozenLockfile = false` in
`bunfig.toml`, and run `bun install`. Restore frozen installs immediately,
review the lockfile changes, and run the applicable checks. Commit the exact
manifest and lockfile together. Do not commit relaxed installation settings.

## Preview publication

When React work needs native SDK changes, complete the known native changes
as one batch and validate the combined SDKs with local packages before
requesting publication. Then pin the actual supporting releases in React and
refresh its locked consumers. Publishing native packages should not be a
prerequisite for testing intermediate changes.

Set a new exact package version before each release. The manual
`Publish preview` GitHub workflow runs only on `main`. It verifies both
React versions and the production starter, then publishes the same
archive used by the React 18 consumer checks to the `next` npm tag with
provenance. Configure npm trusted publishing for `@enbox/react` using this
repository and `publish.yml`, or provide an `NPM_TOKEN` Actions secret with
publish access. npm handles authentication directly.

Dispatch the workflow after merging the release change:

```sh
gh workflow run publish.yml --repo enboxorg/enbox-react --ref main
```

The generator is a separate npm package, `@enbox/create-dapp`. After approval,
dispatch `publish-create-dapp.yml` on `main`. It runs SDK and generator checks,
verifies the generated app against its actual published SDK pin, and publishes
that tested generator archive to
`latest` with provenance. Configure its npm trusted publisher with
`publish-create-dapp.yml`, or give `NPM_TOKEN` access to this package too. A
package's first publication can use the token before its trusted publisher is
configured. Merging changes does not publish either package automatically.

When a template needs a new React release, publish React first, wait for npm
visibility, then dispatch the generator workflow. Its registry-only consumer
check fails if the exact SDK pin is unavailable.
