# Contributing

## Setup and checks

Use the Node and Bun versions in `.node-version` and `.bun-version`.
Install dependencies with `bun install --frozen-lockfile`. Dependency versions
and the allowed peer releases are fixed. `bunfig.toml` disables automatic
runtime installation. The Notes example uses built package exports.

| Command | Purpose |
| --- | --- |
| `bun run build` | Clear generated output and build ESM, declarations, and source maps. |
| `bun run typecheck` | Build public declarations and check source, type contracts, tooling configuration, and the example. |
| `bun run test` | Run unit, React, and native local DWN tests. |
| `bun run test:react18` | Install the packed SDK and run consumer types and regressions with React 18.3.1. |
| `bun run test:package` | Build and verify public runtime exports and client boundaries. |
| `bun run check` | Run type checks, unit/integration tests, and package checks. |
| `bun run test:browser` | Build the production example and run Chromium startup/offline tests. |
| `bun run example:dev` | Serve the Notes example; rebuild the library after editing its source. |

Install Chromium with `bunx --no-install playwright install chromium` before
running browser tests if it is not available. See [testing](docs/testing.md)
for fixture boundaries and integration coverage.

## Code organization

Keep native authentication, protocol, persistence, and replication behavior
in Enbox. This package owns React subscriptions, rendered connection bindings,
view lifetimes, and presentation state. See [architecture](docs/architecture.md)
for those contracts.

Use explicit domain names, preserve native public types, and keep public
exports in the two entrypoint files. Prefix hooks with `use`. Distinguish a
connection binding from a record context: the first identifies the current
facade/session; `within` identifies a protocol context.

Use two-space indentation, explicit type imports, and `.js` specifiers for
local ESM imports. Break long signatures and JSX into readable lines. Comments
should explain ownership or ordering that the code alone does not make clear.

Add regression tests for changes to resource ownership, session guards, or
async error handling. Run the relevant suite while developing, then run
`check`. Changes to startup, worker behavior, or the example also need the
browser suite. Generated `dist` and test reports are not committed.
The repository workflow runs both check suites on pull requests and pushes
to `main`; its actions are pinned to immutable commits.

## Dependency changes

Keep `@enbox/browser` pinned and React peers limited to tested releases so
applications use their own SDK and React instances. `use-sync-external-store`
is the runtime dependency.
Development dependencies support only the build, tests, and example.

| Development dependencies | Use |
| --- | --- |
| `@enbox/api` | Native DWN integration fixtures through `@enbox/api/testing`. |
| `vitest`, `@testing-library/react`, `jsdom` | Unit tests, React lifecycle tests, and the DOM environment. |
| `@playwright/test` | Production browser tests. |
| `typescript`, `@types/react`, `@types/use-sync-external-store` | Compilation, declarations, and type contracts. |
| `react-dom`, `@types/react-dom` | Example rendering and SSR/hydration tests. |
| `@types/node` | Node APIs in tests and tooling configuration. |
| `vite`, `@vitejs/plugin-react` | Example development, build, and preview. |
| `vite-plugin-pwa`, `workbox-precaching`, `workbox-routing` | Example service worker and offline shell. |

For an intentional dependency change, edit the exact version in
`package.json`, temporarily set `install.frozenLockfile = false` in
`bunfig.toml`, and run `bun install`. Restore frozen installs immediately,
review the lockfile changes, and run the applicable checks. Commit the exact
manifest and lockfile together. Do not commit relaxed installation settings.

## Preview publication

Set a new exact package version before each release. The manual
`Publish preview` GitHub workflow runs only on `main`. It verifies both
React versions and the production browser example, then publishes the same
archive used by the React 18 consumer checks to the `next` npm tag with
provenance. Configure `NPM_TOKEN` in the repository's Actions secrets with
publish access to `@enbox/react`.

Dispatch the workflow after merging the release change:

```sh
gh workflow run publish.yml --repo enboxorg/enbox-react --ref main
```
