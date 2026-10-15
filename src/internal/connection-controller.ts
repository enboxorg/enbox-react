import type {
  BrowserConnectHandlerOptions, ConnectionSnapshot, ConnectionStore,
  DwnEndpointResolution,
} from '@enbox/browser';
import { isConnectDeniedError } from '@enbox/browser';

import { createWalletConnectHandler } from '../config/client.js';
import { EnboxBindingChangedError } from '../errors.js';
import { isConnectionBindingCurrent } from './connection-binding.js';
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

function projectConnectionState(snapshot: ConnectionSnapshot, workflow: Workflow): EnboxConnectionState {
  const hasRetainedSession = snapshot.phase === 'connecting' && snapshot.walletReapprovalRequired === true
    && snapshot.enbox !== undefined && snapshot.session !== undefined;
  const isConnected = snapshot.phase === 'connected' || hasRetainedSession;
  const session = isConnected ? snapshot.session : undefined;
  const workflowError = workflow.error?.binding.enbox === snapshot.enbox
    && workflow.error?.binding.session === snapshot.session ? workflow.error?.value : undefined;
  const error = workflowError ?? snapshot.error;
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
const SERVER_STATE = projectConnectionState({ phase: 'initializing' }, EMPTY_WORKFLOW);
const RETIRED_STATE = projectConnectionState({ phase: 'disconnected' }, EMPTY_WORKFLOW);

/** Provider-scoped presentation and guards; native client disposal stays with its owner. */
export class ConnectionController {
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private workflow = EMPTY_WORKFLOW;
  private cachedConnection?: ConnectionSnapshot;
  private cachedWorkflow?: Workflow;
  private cachedState = SERVER_STATE;
  private connectPromise: Promise<void> | undefined;
  private disconnectPromise: Promise<void> | undefined;
  private workflowGeneration = 0;
  private cancelConnect: ((reason?: Error) => void) | undefined;
  private retainCount = 0;
  private retentionGeneration = 0;
  private retired = false;

  public constructor(
    private readonly client: ConnectionStore,
    private readonly walletDefaults?: BrowserConnectHandlerOptions,
  ) {}

  public isRetired(): boolean { return this.retired; }

  /** The provider owns this workflow independently of its hook subscribers. */
  public retain(): () => void {
    if (this.retired) throw new EnboxBindingChangedError();
    this.retainCount += 1;
    this.retentionGeneration += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retainCount -= 1;
      const generation = ++this.retentionGeneration;
      // Effect replay can retain the controller again before this cleanup runs.
      queueMicrotask(() => {
        if (this.retainCount === 0 && this.retentionGeneration === generation) this.retire();
      });
    };
  }

  public readonly getSnapshot = (): EnboxConnectionState => {
    if (this.retired) return RETIRED_STATE;
    const connection = this.client.getSnapshot();
    if (this.cachedConnection !== connection || this.cachedWorkflow !== this.workflow) {
      this.cachedConnection = connection;
      this.cachedWorkflow = this.workflow;
      this.cachedState = projectConnectionState(connection, this.workflow);
    }
    return this.cachedState;
  };
  public readonly getServerSnapshot = (): EnboxConnectionState => SERVER_STATE;
  public readonly subscribe = (notify: () => void): (() => void) => {
    if (this.retired) return () => {};
    const listener = (): void => { notify(); };
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.unsubscribe = this.client.subscribe(() => this.notify());
    return () => {
      if (!this.listeners.delete(listener) || this.listeners.size !== 0) return;
      const unsubscribe = this.unsubscribe;
      // Preserve a replacement handle installed synchronously by native cleanup.
      this.unsubscribe = undefined;
      try { unsubscribe?.(); } catch (cause: unknown) { reportCleanupError(cause); }
    };
  };

  public connect(options: ConnectOptions | undefined, policy: ConnectionPolicy): Promise<void> {
    if (!this.isAvailable()) return Promise.reject(new EnboxBindingChangedError());
    if (this.connectPromise !== undefined) return this.connectPromise;
    let expected = this.client.getSnapshot();
    const generation = this.workflowGeneration;
    const repairReason = expected.walletReapprovalRequired === true
      ? walletRepairReason(expected.connection?.state) : undefined;
    const cancelled = new Promise<void>((resolve, reject) => {
      this.cancelConnect = (reason) => {
        // Disconnect settles a waiting connect quietly; retirement rejects it.
        if (reason === undefined) resolve();
        else reject(reason);
      };
    });
    const operation = Promise.resolve().then(async () => {
      this.assertWorkflowCurrent(generation);
      if (expected.phase === 'initializing') {
        await this.client.initialize();
        // Disconnect can cancel this flow while initialization restores a
        // session. Retired flows must not publish repair state or run guards.
        this.assertWorkflowCurrent(generation);
        expected = this.client.getSnapshot();
        this.update({ repairReason: expected.walletReapprovalRequired === true
          ? walletRepairReason(expected.connection?.state) : undefined });
      }
      this.assertWorkflowCurrent(generation, expected);
      await policy.beforeConnect?.({ snapshot: expected, options });
      this.assertWorkflowCurrent(generation, expected);
      let nativeOptions: NativeConnectOptions | undefined = options;
      if (options?.wallet !== undefined) {
        if (options.connectHandler !== undefined) throw new TypeError('Choose wallet options or a connectHandler, not both.');
        const { wallet, ...rest } = options;
        // Per-call wallet choice keeps the app identity configured by the provider.
        const handler = createWalletConnectHandler({ ...this.walletDefaults, ...wallet });
        nativeOptions = { ...rest, connectHandler: handler };
      }
      // Once native work starts, cancellation must preserve its original outcome.
      this.cancelConnect = undefined;
      const result = nativeOptions === undefined ? await this.client.connect() : await this.client.connect(nativeOptions);
      if (result.error !== undefined && result.walletReapprovalRequired !== true && !isConnectDeniedError(result.error)) {
        throw result.error;
      }
    });
    const connectPromise = Promise.race([operation, cancelled]).catch((cause: unknown) => {
      if (this.isAvailable() && generation === this.workflowGeneration && isConnectionBindingCurrent(this.client, expected)) {
        this.update({ error: { value: toError(cause), binding: expected } });
      }
      throw cause;
    }).finally(() => {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = undefined;
        this.cancelConnect = undefined;
        this.update({ connecting: false, repairReason: undefined });
      }
    });
    this.connectPromise = connectPromise;
    this.update({ connecting: true, repairReason, error: undefined });
    return connectPromise;
  }

  public disconnect(options: DisconnectOptions | undefined, policy: ConnectionPolicy): Promise<void> {
    if (!this.isAvailable()) return Promise.reject(new EnboxBindingChangedError());
    if (this.disconnectPromise !== undefined) return this.disconnectPromise;
    // Invalidate a connect waiting on a host guard before native auth starts.
    this.workflowGeneration += 1;
    this.cancelConnect?.();
    const generation = this.workflowGeneration;
    const expected = this.client.getSnapshot();
    const disconnectPromise = Promise.resolve().then(async () => {
      this.assertWorkflowCurrent(generation, expected);
      if (options?.skipBeforeDisconnect !== true) await policy.beforeDisconnect?.(options);
      this.assertWorkflowCurrent(generation, expected);
      const { skipBeforeDisconnect: _skip, ...native } = options ?? {};
      const result = options === undefined ? await this.client.disconnect() : await this.client.disconnect(native);
      if (result.error !== undefined) throw result.error;
    }).catch((cause: unknown) => {
      if (this.isAvailable() && generation === this.workflowGeneration && isConnectionBindingCurrent(this.client, expected)) {
        this.update({ error: { value: toError(cause), binding: expected } });
      }
      throw cause;
    }).finally(() => {
      if (this.disconnectPromise === disconnectPromise) {
        this.disconnectPromise = undefined;
        this.update({ disconnecting: false });
      }
    });
    this.disconnectPromise = disconnectPromise;
    this.update({ disconnecting: true, error: undefined });
    return disconnectPromise;
  }

  public readonly refreshDwnEndpoints = async (): Promise<DwnEndpointResolution | undefined> => {
    this.assertAvailable();
    const result = await this.client.refreshDwnEndpoints();
    if (result.error !== undefined) throw result.error;
    return result.remoteDwn;
  };
  public readonly retryRemote = async (endpoint: string): Promise<void> => {
    this.assertAvailable();
    const result = await this.client.retryRemote(endpoint);
    if (result.error !== undefined) throw result.error;
  };

  private isAvailable(): boolean {
    // Standalone controllers need no lease. Once a provider retains one,
    // actions also require a live lease while deferred retirement is pending.
    return !this.retired && (this.retentionGeneration === 0 || this.retainCount > 0);
  }
  private assertAvailable(): void {
    if (!this.isAvailable()) throw new EnboxBindingChangedError();
  }
  private assertWorkflowCurrent(generation: number, expected?: ConnectionSnapshot): void {
    this.assertAvailable();
    if (generation !== this.workflowGeneration
      || (expected !== undefined && !isConnectionBindingCurrent(this.client, expected))) {
      throw new EnboxBindingChangedError();
    }
  }
  private retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.workflowGeneration += 1;
    this.cancelConnect?.(new EnboxBindingChangedError());
    this.cancelConnect = undefined;
    this.connectPromise = undefined;
    this.disconnectPromise = undefined;
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
