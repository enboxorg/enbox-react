import type {
  BrowserConnectHandlerOptions, ConnectionSnapshot, ConnectionStore,
  DwnEndpointResolution,
} from '@enbox/browser';
import { isConnectDeniedError } from '@enbox/browser';

import { createWalletConnectHandler } from '../config/client.js';
import { EnboxBindingChangedError } from '../errors.js';
import { reportCleanupError, toError } from './errors.js';

type NativeConnectOptions = NonNullable<Parameters<ConnectionStore['connect']>[0]>;
type NativeDisconnectOptions = NonNullable<Parameters<ConnectionStore['disconnect']>[0]>;

export type ConnectOptions = Omit<NativeConnectOptions, 'connectHandler'> & (
  | { wallet?: BrowserConnectHandlerOptions; connectHandler?: never }
  | { connectHandler: NonNullable<NativeConnectOptions['connectHandler']>; wallet?: never }
);
export type DisconnectOptions = NativeDisconnectOptions & {
  /** The host explicitly chose an alternative to its normal disconnect guard. */
  skipBeforeDisconnect?: boolean;
};
export type BeforeConnect = (context: Readonly<{
  snapshot: ConnectionSnapshot;
  options: ConnectOptions | undefined;
}>) => void | Promise<void>;
export type BeforeDisconnect = (options: DisconnectOptions | undefined) => void | Promise<void>;
export type ConnectionPolicy = Readonly<{
  beforeConnect?: BeforeConnect | undefined;
  beforeDisconnect?: BeforeDisconnect | undefined;
}>;

export type WalletRepairReason = 'expired' | 'revoked' | 'permissions-changed';
export type WalletRepairState = Readonly<{ reason: WalletRepairReason; status: 'required' | 'waiting' }>;

export function walletRepairReason(state: string | undefined): WalletRepairReason {
  return state === 'expired' || state === 'revoked' ? state : 'permissions-changed';
}

export type EnboxConnectionState = Readonly<{
  enbox: ConnectionSnapshot['enbox'];
  did: string | undefined;
  identityName: string | undefined;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  walletRepair: WalletRepairState | undefined;
  connectionError: Error | undefined;
  sync: ConnectionSnapshot['sync'];
  remoteDwn: DwnEndpointResolution | undefined;
}>;

type Workflow = Readonly<{
  connecting: boolean;
  disconnecting: boolean;
  repairReason?: WalletRepairReason | undefined;
  error?: Readonly<{ value: Error; binding: ConnectionSnapshot }> | undefined;
}>;
const EMPTY_WORKFLOW: Workflow = Object.freeze({ connecting: false, disconnecting: false });

function project(snapshot: ConnectionSnapshot, workflow: Workflow): EnboxConnectionState {
  const retained = snapshot.phase === 'connecting' && snapshot.walletReapprovalRequired === true
    && snapshot.enbox !== undefined && snapshot.session !== undefined;
  const isConnected = snapshot.phase === 'connected' || retained;
  const session = isConnected ? snapshot.session : undefined;
  const guardedError = workflow.error?.binding.enbox === snapshot.enbox
    && workflow.error?.binding.session === snapshot.session ? workflow.error?.value : undefined;
  const error = guardedError ?? snapshot.error;
  return Object.freeze({
    enbox: isConnected ? snapshot.enbox : undefined,
    did: session?.did,
    identityName: session?.identity.name.trim() || undefined,
    isConnected,
    isConnecting: workflow.connecting || snapshot.phase === 'initializing' || snapshot.phase === 'connecting',
    isDisconnecting: workflow.disconnecting || snapshot.phase === 'disconnecting',
    walletRepair: workflow.repairReason !== undefined
      ? { reason: workflow.repairReason, status: 'waiting' as const }
      : snapshot.walletReapprovalRequired === true
        ? { reason: walletRepairReason(snapshot.connection?.state), status: 'required' as const }
        : undefined,
    connectionError: error !== undefined && !isConnectDeniedError(error) ? error : undefined,
    sync: snapshot.sync,
    remoteDwn: isConnected ? snapshot.remoteDwn : undefined,
  });
}
const SERVER_STATE = project({ phase: 'initializing' }, EMPTY_WORKFLOW);
const RETIRED_STATE = project({ phase: 'disconnected' }, EMPTY_WORKFLOW);

/** Shared presentation and guards over the native connection workflow. */
export class ConnectionController {
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private workflow = EMPTY_WORKFLOW;
  private connection?: ConnectionSnapshot;
  private cachedWorkflow?: Workflow;
  private state = SERVER_STATE;
  private connecting: Promise<void> | undefined;
  private disconnecting: Promise<void> | undefined;
  private generation = 0;
  private cancelConnect: ((reason?: Error) => void) | undefined;
  private owners = 0;
  private ownerGeneration = 0;
  private retained = false;
  private retired = false;

  public constructor(
    private readonly client: ConnectionStore,
    private readonly wallet?: BrowserConnectHandlerOptions,
  ) {}

  public isRetired(): boolean { return this.retired; }

  /** The provider owns this workflow independently of its hook subscribers. */
  public retain(): () => void {
    if (this.retired) throw new EnboxBindingChangedError();
    this.retained = true;
    this.owners += 1;
    this.ownerGeneration += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.owners -= 1;
      const generation = ++this.ownerGeneration;
      queueMicrotask(() => {
        if (this.owners === 0 && this.ownerGeneration === generation) this.retire();
      });
    };
  }

  public readonly getSnapshot = (): EnboxConnectionState => {
    if (this.retired) return RETIRED_STATE;
    const connection = this.client.getSnapshot();
    if (this.connection !== connection || this.cachedWorkflow !== this.workflow) {
      this.connection = connection;
      this.cachedWorkflow = this.workflow;
      this.state = project(connection, this.workflow);
    }
    return this.state;
  };
  public readonly getServerSnapshot = (): EnboxConnectionState => SERVER_STATE;
  public readonly subscribe = (notify: () => void): (() => void) => {
    if (this.retired) return () => {};
    const listener = (): void => { notify(); };
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.unsubscribe = this.client.subscribe(() => this.notify());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) { this.unsubscribe?.(); this.unsubscribe = undefined; }
    };
  };

  public connect(options: ConnectOptions | undefined, policy: ConnectionPolicy): Promise<void> {
    if (!this.isOwned()) return Promise.reject(new EnboxBindingChangedError());
    if (this.connecting !== undefined) return this.connecting;
    let expected = this.client.getSnapshot();
    const generation = this.generation;
    const repairReason = expected.walletReapprovalRequired === true
      ? walletRepairReason(expected.connection?.state) : undefined;
    let nativeIssued = false;
    const cancelled = new Promise<void>((resolve, reject) => {
      this.cancelConnect = (reason) => {
        // A retiring provider fences a guard but leaves an issued wallet
        // operation's Promise and SDK lifetime intact.
        if (reason !== undefined && nativeIssued) return;
        if (reason === undefined) resolve();
        else reject(reason);
      };
    });
    const operation = Promise.resolve().then(async () => {
      this.assertGeneration(generation);
      if (expected.phase === 'initializing') {
        await this.client.initialize();
        // Disconnect can cancel this flow while initialization restores a
        // session. Retired flows must not publish repair state or run guards.
        this.assertGeneration(generation);
        expected = this.client.getSnapshot();
        this.update({ repairReason: expected.walletReapprovalRequired === true
          ? walletRepairReason(expected.connection?.state) : undefined });
      }
      this.assertGeneration(generation);
      this.assertBinding(expected);
      await policy.beforeConnect?.({ snapshot: expected, options });
      this.assertGeneration(generation);
      this.assertBinding(expected);
      let native: NativeConnectOptions | undefined = options;
      if (options?.wallet !== undefined) {
        if (options.connectHandler !== undefined) throw new TypeError('Choose wallet options or a connectHandler, not both.');
        const { wallet, ...rest } = options;
        const base = this.wallet ?? {};
        // Per-call wallet choice keeps the app identity configured by the provider.
        const handler = createWalletConnectHandler({ ...base, ...wallet });
        native = { ...rest, connectHandler: handler };
      }
      nativeIssued = true;
      const result = native === undefined ? await this.client.connect() : await this.client.connect(native);
      if (result.error !== undefined && result.walletReapprovalRequired !== true && !isConnectDeniedError(result.error)) {
        throw result.error;
      }
    });
    const connecting = Promise.race([operation, cancelled]).catch((cause: unknown) => {
      if (this.isOwned() && generation === this.generation && this.sameBinding(expected)) {
        this.update({ error: { value: toError(cause), binding: expected } });
      }
      throw cause;
    }).finally(() => {
      if (this.connecting === connecting) {
        this.connecting = undefined;
        this.cancelConnect = undefined;
        this.update({ connecting: false, repairReason: undefined });
      }
    });
    this.connecting = connecting;
    this.update({ connecting: true, repairReason, error: undefined });
    return connecting;
  }

  public disconnect(options: DisconnectOptions | undefined, policy: ConnectionPolicy): Promise<void> {
    if (!this.isOwned()) return Promise.reject(new EnboxBindingChangedError());
    if (this.disconnecting !== undefined) return this.disconnecting;
    // Invalidate a connect waiting on a host guard before native auth starts.
    this.generation += 1;
    this.cancelConnect?.();
    const generation = this.generation;
    const expected = this.client.getSnapshot();
    const disconnecting = Promise.resolve().then(async () => {
      this.assertGeneration(generation);
      this.assertBinding(expected);
      if (options?.skipBeforeDisconnect !== true) await policy.beforeDisconnect?.(options);
      this.assertGeneration(generation);
      this.assertBinding(expected);
      const { skipBeforeDisconnect: _skip, ...native } = options ?? {};
      const result = options === undefined ? await this.client.disconnect() : await this.client.disconnect(native);
      if (result.error !== undefined) throw result.error;
    }).catch((cause: unknown) => {
      if (this.isOwned() && generation === this.generation && this.sameBinding(expected)) {
        this.update({ error: { value: toError(cause), binding: expected } });
      }
      throw cause;
    }).finally(() => {
      if (this.disconnecting === disconnecting) {
        this.disconnecting = undefined;
        this.update({ disconnecting: false });
      }
    });
    this.disconnecting = disconnecting;
    this.update({ disconnecting: true, error: undefined });
    return disconnecting;
  }

  public readonly refreshDwnEndpoints = async (): Promise<DwnEndpointResolution | undefined> => {
    this.assertOwned();
    const result = await this.client.refreshDwnEndpoints();
    if (result.error !== undefined) throw result.error;
    return result.remoteDwn;
  };
  public readonly retryRemote = async (endpoint: string): Promise<void> => {
    this.assertOwned();
    const result = await this.client.retryRemote(endpoint);
    if (result.error !== undefined) throw result.error;
  };

  private sameBinding(expected: ConnectionSnapshot): boolean {
    const current = this.client.getSnapshot();
    return current.enbox === expected.enbox && current.session === expected.session
      && expected.session?.signal.aborted !== true;
  }
  private assertBinding(expected: ConnectionSnapshot): void {
    this.assertOwned();
    if (!this.sameBinding(expected)) throw new EnboxBindingChangedError();
  }
  private isOwned(): boolean {
    return !this.retired && (!this.retained || this.owners > 0);
  }
  private assertOwned(): void {
    if (!this.isOwned()) throw new EnboxBindingChangedError();
  }
  private assertGeneration(generation: number): void {
    this.assertOwned();
    if (generation !== this.generation) throw new EnboxBindingChangedError();
  }
  private retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.generation += 1;
    this.cancelConnect?.(new EnboxBindingChangedError());
    this.cancelConnect = undefined;
    this.connecting = undefined;
    this.disconnecting = undefined;
    this.workflow = EMPTY_WORKFLOW;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    try { unsubscribe?.(); } catch (cause) { reportCleanupError(cause); }
    this.notify();
    this.listeners.clear();
  }
  private update(change: Partial<Workflow>): void {
    this.workflow = Object.freeze({ ...this.workflow, ...change });
    this.notify();
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
