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

const walletOptionsByClient = new WeakMap<ConnectionStore, BrowserConnectHandlerOptions>();

/** Preserve wallet defaults when a factory-created client is passed to a provider. */
export function getClientWalletOptions(client: ConnectionStore): BrowserConnectHandlerOptions | undefined {
  return walletOptionsByClient.get(client);
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

  const walletOptions = options.connectHandler === undefined ? Object.freeze({ ...options.wallet }) : undefined;
  const connectHandler = options.connectHandler ?? createWalletConnectHandler(walletOptions);

  const client = createConnectionStore({
    ...options.connection,
    application: options.application,
    connectHandler,
  });
  if (walletOptions !== undefined) walletOptionsByClient.set(client, walletOptions);
  return client;
}

/** Resolve browser URLs when approval starts, so configuration stays inert. */
export function createWalletConnectHandler(options: BrowserConnectHandlerOptions = {}): ConnectHandler {
  const wallet = { ...options };
  return {
    requestAccess: (request) => {
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
