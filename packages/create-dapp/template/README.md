# Hello, Enbox

A small React app with a wallet connection, a read-only public profile, and
a private task board with projects and tasks. No application server is required.

## Run it

Use Node 22.12 or newer:

```sh
npm install
npm run dev
```

Open the local URL and choose **Connect wallet**. Enbox handles wallet selection
and approval. Create a project, add tasks, and check them off as you finish.
Select a task to edit its title or delete it. Completed tasks can be reopened.
Switching projects selects that project’s own tasks. Saved values come from native
live record views and are restored when this profile returns.

```sh
npm run typecheck
npm run build
npm run preview
```

The app owns its service worker. Startup waits until that worker controls the
page before initializing Enbox. Vite bundles the worker without a separate PWA
toolchain. Production builds precache the app shell for
later offline visits; `npm run preview` serves that built app locally. Deploy
the generated `dist` directory on an HTTPS origin with service worker support.

You can also use `bun install` and `bun run dev`. No lockfile is generated
until your first install. Commit the resulting `package-lock.json` or `bun.lock`;
then use `npm ci` or `bun install --frozen-lockfile` in CI. Direct dependencies
use exact versions. Update the manifest and your lockfile together when
accepting dependency or security fixes.

## Make it yours

`src/app.json` contains the display name used in the page, browser title, and
wallet approval screen, plus a stable app ID. Changing the display name leaves
the app ID and demo data namespace intact. `src/application.ts` defines the application manifest
and wallet configuration. `src/main.tsx` mounts the SDK provider; `src/App.tsx`
contains the app shell without owning authentication state.

The profile card reads published profile information through `useProfile`.
Names, images, settlement state, and image URL lifetimes belong to the SDK.
Missing profiles and unavailable images have local display fallbacks.
The wallet's profile label is used when a public display name is unavailable;
the expanded details still show which name is publicly published.

The removable demo lives entirely in `src/demo`:

- `protocol.ts` declares encrypted `project` and `project/task` records with
  payload validators. Tasks store a title and completion state.
- `use-task-board.ts` defines `useProjects`, `useTasks`, and `useTask` with
  `useEnboxRecords` and `useEnboxRecord`. A child selection takes its direct
  parent context ID; task details also select an exact record ID.
- `TaskBoard.tsx` renders the board and calls typed create, patch, and delete commands.
  Event handlers use `mutate`; forms await `mutateAsync` and check `isCurrent()`
  before clearing their draft. Native observation updates the displayed data.
- `demo.css` styles the demo. Shared app and profile styles live in `src/style.css`.

To replace the demo, register your own typed application protocol in
`application.ts` in place of `TaskBoardProtocol`. Then delete `src/demo` and remove
the `TaskBoard` import and component from `App.tsx`. Enbox requires at least one
application protocol, so keep your replacement registered. The profile card,
connection shell, and service worker remain the base for your app.

The demo's default protocol URI is
`https://example.com/<encoded app ID>/demo/v2`. Replace the URI expression in
`src/demo/protocol.ts` with a stable URI
you control before publishing. This URI identifies saved records and wallet
grants: changing it creates a different data namespace. Once deployed, keep
that identifier fixed when changing the app's display name.

Public profile information and the encrypted task board are separate. Task
updates change this app’s private records; they do not edit the public profile.
