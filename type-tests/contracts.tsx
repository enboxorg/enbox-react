import type { ConnectionSnapshot, VaultConnectOptions as NativeVaultConnectOptions } from '@enbox/browser';
import type { BeforeConnect, VaultConnectOptions } from '@enbox/react';

import { createApplication } from '@enbox/browser';
import { EnboxProvider, useApplication, useEnboxConnection, useProfile, useProfiles } from '@enbox/react';

const application = createApplication({ stores: {}, wallet: { appName: 'Notes' } });
const vaultOptions: VaultConnectOptions = { password: 'test-only', createIdentity: true, metadata: { name: 'Local' } };
const nativeVaultOptions: NativeVaultConnectOptions = vaultOptions;
const publicVaultOptions: VaultConnectOptions = nativeVaultOptions;
const beforeConnect: BeforeConnect = (context) => {
  const snapshot: ConnectionSnapshot = context.snapshot;
  void snapshot;
  if (context.action === 'connectVault') {
    const create: boolean | undefined = context.options?.createIdentity;
    void create;
    // @ts-expect-error vault guards expose native vault options, not wallet handler options
    void context.options?.wallet;
  } else {
    const name: string | undefined = context.options?.wallet?.appName;
    void name;
    const create: undefined = context.options?.createIdentity;
    void create;
  }
};

export function Contract(): React.ReactNode {
  const runtime = useApplication();
  const connection = useEnboxConnection();
  const vault: Promise<void> = connection.connectVault(publicVaultOptions);
  const nativeVault: Promise<ConnectionSnapshot> = runtime.connection.connectVault(nativeVaultOptions);
  void vault;
  void nativeVault;
  // @ts-expect-error vault connections do not accept wallet UI options
  connection.connectVault({ wallet: { appName: 'Notes' } });
  // @ts-expect-error native vault actions do not accept a wallet connect handler
  runtime.connection.connectVault({ connectHandler: { requestAccess: async () => undefined } });
  // @ts-expect-error local vault creation is explicit, not a wallet connect option
  connection.connect({ createIdentity: true });
  const profileName: string | undefined = useProfile(connection.enbox, connection.did).displayName;
  const profile = useProfile(connection.enbox, connection.did, { images: 'lazy' });
  const status: 'idle' | 'loading' | 'settled' | 'not-found' | 'error' = profile.status;
  const imageRequest: Promise<void> = profile.loadImages();
  const profiles = useProfiles(connection.enbox, [connection.did ?? ''], { images: 'off' });
  const profileFailure: string | undefined = profiles.get(connection.did ?? '')?.fields.profile.failure?.message;
  void status;
  void imageRequest;
  void profileFailure;
  // @ts-expect-error image policy is restricted to the supported modes
  useProfile(connection.enbox, connection.did, { images: 'all' });
  void connection.disconnect({ skipBeforeDisconnect: true });
  // @ts-expect-error per-call wallet and handler configuration are mutually exclusive
  void connection.connect({ wallet: {}, connectHandler: { requestAccess: async () => undefined } });
  return <EnboxProvider application={application} beforeConnect={beforeConnect}>{profileName}</EnboxProvider>;
}
