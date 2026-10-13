import type {
  ApplicationManifest,
  BrowserConnectHandlerOptions,
  ConnectHandler,
  ConnectionStore,
  ConnectionStoreOptions,
} from '@enbox/browser';

import { BrowserConnectHandler, createConnectionStore } from '@enbox/browser';

export type CreateEnboxClientOptions = {
  application: ApplicationManifest;
  connection?: Omit<ConnectionStoreOptions, 'application' | 'connectHandler' | 'auth' | 'agent'>;
} & (
  | { wallet?: BrowserConnectHandlerOptions; connectHandler?: never }
  | { connectHandler: ConnectHandler; wallet?: never }
);

const clientWalletOptions = new WeakMap<ConnectionStore, BrowserConnectHandlerOptions>();

/** Factory metadata used by providers without changing the native client type. */
export function getClientWalletOptions(client: ConnectionStore): BrowserConnectHandlerOptions | undefined {
  return clientWalletOptions.get(client);
}

/**
 * Creates an inert, application-owned ConnectionStore. Initialization and
 * disposal retain the native SDK contract. Interactive renewal is opt-in.
 */
export function createEnboxClient(options: CreateEnboxClientOptions): ConnectionStore {
  if (options.wallet !== undefined && options.connectHandler !== undefined) {
    throw new TypeError('Choose wallet options or a connectHandler, not both.');
  }
  for (const key of ['application', 'connectHandler', 'auth', 'agent']) {
    if (options.connection !== undefined && Object.hasOwn(options.connection, key)) {
      throw new TypeError(`createEnboxClient: connection.${key} is not supported.`);
    }
  }

  const wallet = options.connectHandler === undefined ? Object.freeze({ ...options.wallet }) : undefined;
  const connectHandler = options.connectHandler ?? createWalletConnectHandler(wallet);

  const client = createConnectionStore({
    ...options.connection,
    application: options.application,
    connectHandler,
  });
  if (wallet !== undefined) clientWalletOptions.set(client, wallet);
  return client;
}

/** Resolve browser URLs when approval starts, so configuration stays inert. */
export function createWalletConnectHandler(options: BrowserConnectHandlerOptions = {}): ConnectHandler {
  const wallet = { ...options };
  return {
    requestAccess: (request) => {
      // Resolve browser URLs when wallet approval starts, so construction is inert.
      const appIcon = wallet.appIcon === undefined
        ? undefined
        : new URL(wallet.appIcon, window.location.origin).href;
      return BrowserConnectHandler({
        ...wallet,
        ...(appIcon === undefined ? {} : { appIcon }),
      }).requestAccess(request);
    },
  };
}
