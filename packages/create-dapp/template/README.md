# Hello, Enbox

A small React app with a wallet connection, a read-only public profile, and one
private choice saved through Enbox. No application server is required.

## Run it

Use Node 22.12 or newer:

```sh
npm ci
npm run dev
```

Open the local URL and choose **Connect wallet**. Enbox handles wallet selection
and approval. Once connected, choose an emoji. The displayed choice comes from
the live record view and is restored when this profile returns.

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

Direct dependencies use exact versions; `npm ci` installs the committed
dependency tree. Update the manifest and lockfile together when accepting
dependency or security fixes.

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

- `protocol.ts` declares an encrypted singleton record and validates its emoji.
- `Demo.tsx` reads through `useRecords` and writes absolute choices through
  `useEnboxMutation` and the typed `records.set` API.
- `demo.css` styles the demo. Shared app and profile styles live in `src/style.css`.

To replace the demo, register your own typed application protocol in
`application.ts` in place of `DemoProtocol`. Then delete `src/demo` and remove
the `Demo` import and component from `App.tsx`. Enbox requires at least one
application protocol, so keep your replacement registered. The profile card,
connection shell, and service worker remain the base for your app.

The demo's default protocol URI is
`https://example.com/<encoded app ID>/demo/v1`. Replace the URI expression in
`src/demo/protocol.ts` with a stable URI
you control before publishing. This URI identifies saved records and wallet
grants: changing it creates a different data namespace. Once deployed, keep
that identifier fixed when changing the app's display name.

Public profile information and the encrypted demo choice are separate. Choosing
an emoji updates this app's private record; it does not edit the public profile.
