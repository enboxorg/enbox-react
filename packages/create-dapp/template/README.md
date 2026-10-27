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
the app ID and task-board data namespace intact.

The application follows the same feature-store structure as notesd:

```text
src/
  app/
    application.ts      # feature registration and wallet identity
    runtime.ts          # one browser-lifetime application owner
    App.tsx             # connection shell and feature composition
  features/tasks/
    protocol.ts         # typed encrypted records and validation
    store.ts            # shared resources, commands, and domain defaults
    components/         # task board and its styles
  shared/components/
    ProfileCard.tsx
  main.tsx
  sw.ts
```

`defineApplication` derives the protocol manifest from registered stores.
`getApplication()` creates one headless runtime over a native connection.
`main.tsx` waits for worker control before passing that runtime to
`EnboxProvider application={...}`. The provider initializes the borrowed runtime;
the application owns its lifetime. Development module replacement disposes it.

The profile card reads published profile information through `useProfile`.
Names, images, settlement state, and image URL lifetimes belong to the SDK.
Missing profiles and unavailable images have local display fallbacks.
The wallet's profile label is used when a public display name is unavailable;
the expanded details still show which name is publicly published.

The replaceable task feature lives in `src/features/tasks`:

- `protocol.ts` declares encrypted `project` and `project/task` records with
  payload validators. Tasks store a title and completion state.
- `store.ts` declares one shared project collection and a task collection scoped
  with `tasks.within(projectContextId)`. Its `activeTasks` selection owner keeps
  the chosen project's query live through `selectProject`; parent metadata and
  rows arrive together. Creation and rename defaults live here. Native resource
  commands share pending/error state across consumers.
- `components/TaskBoard.tsx` resolves the feature with `useFeature(TaskBoardStore)`
  and reads resources or commands with `useStore`. Task details reuse loaded list
  rows and acquire a bounded single-record observation for a selection outside
  the retained window. Input drafts and task-detail selection remain in React.
  Awaited handlers check command authorization before applying their UI result.
- `components/tasks.css` styles the task feature. Shared app and profile styles
  live in `src/style.css`.

Application controllers use the same store instance as React:

```ts
const board = getApplication().store(TaskBoardStore);
const release = board.projects.retain();
try {
  const state = await board.projects.ready();
  // Use state.records in a controller or indexer.
} finally {
  release();
}
```

Handles belong to their authorization session. Resolve a fresh feature when
that session changes. React's `useFeature` handles that replacement automatically.
`activeTasks` owns its selected query until another project, null, or session
retirement. Other callers can create independent owners with
`board.tasks.createSelection({ signal })`; commands remain on canonical
`tasks.within(parentContextId)` handles.

To replace the task feature, register your own store in `app/application.ts`,
delete `src/features/tasks`, and change the feature rendered by `app/App.tsx`.
Enbox requires at least one application protocol, so keep your replacement
registered. The profile card, connection shell, and service worker remain the
base for your app.

The demo's default protocol URI is
`https://example.com/<encoded app ID>/demo/v2`. Replace the URI expression in
`src/features/tasks/protocol.ts` with a stable URI
you control before publishing. This URI identifies saved records and wallet
grants: changing it creates a different data namespace. Once deployed, keep
that identifier fixed when changing the app's display name.

Public profile information and the encrypted task board are separate. Task
updates change this app’s private records; they do not edit the public profile.
