# @enbox/create-dapp

Create a minimal Enbox React app with a wallet connection, a profile card,
and a removable private-data demo.

Requires Node.js 22.12.0 or newer. Create an app with either command:

```sh
npm create @enbox/dapp@latest my-app
# or
npx @enbox/create-dapp@latest my-app
```

Then run:

```sh
cd my-app
npm ci
npm run dev
```

The generator copies its bundled template into a new or empty directory. It
does not install packages, run Git, or make network requests. It refuses
nonempty destinations and symbolic-link targets; there is no force option.
Use `.` for an empty current directory. Omitting the directory prompts in an
interactive terminal; scripts must provide it explicitly.

The directory's basename becomes the display name in `src/app.json`. Its
normalized lowercase npm name becomes both the package name and the stable
`app.json` ID, and the bundled lockfile is updated to match. The ID identifies
the app to the wallet and defines its private demo protocol namespace. Keep
the ID when changing the display name so saved data remains in the same
namespace. Source code is copied unchanged. Run `--help` for usage or
`--version` for the generator version.

From this repository, run the CLI and its tests without publishing:

```sh
node packages/create-dapp/bin/create-dapp.mjs /tmp/my-enbox-app
node --test packages/create-dapp/tests/*.test.mjs
```
