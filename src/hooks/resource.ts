'use client';

import type { ConnectionSnapshot, ConnectionStore } from '@enbox/browser';
import type { ConnectionBinding } from '../internal/connection-binding.js';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { isConnectionBindingCurrent, sameConnectionBinding, selectConnectionBinding, subscribeToConnectionBinding } from '../internal/connection-binding.js';
import { reportCleanupError, toError } from '../internal/errors.js';
import { useConnectionStore } from './connection.js';
import { useProviderContext } from '../provider.js';

export type EnboxResourceContext = Readonly<{
  client: ConnectionStore;
  enbox: NonNullable<ConnectionBinding['enbox']>;
  session: NonNullable<ConnectionBinding['session']>;
  signal: AbortSignal;
}>;
type Closable = { close(): void | Promise<void>; drain?(): void | Promise<void> };
type ResourceState<Resource> = Readonly<
  | { status: 'idle' | 'loading'; data: undefined; error: undefined }
  | { status: 'ready'; data: Resource; error: undefined }
  | { status: 'error'; data: undefined; error: Error }
>;
export type EnboxResourceOptions<Resource> = Readonly<{
  /** Product-specific disposal, including resources that initialized after retirement. */
  dispose?(resource: Resource, context: EnboxResourceContext & {
    wasPublished: boolean;
    /** Native transition snapshot captured at retirement, including for late initialization. */
    snapshot: ConnectionSnapshot;
  }): void | Promise<void>;
}>;
export type EnboxResourceResult<Resource> = ResourceState<Resource> & Readonly<{
  /** Schedule initialization again for the current connection. */
  retry(): void;
}>;
const IDLE = Object.freeze({ status: 'idle', data: undefined, error: undefined } as const);
const LOADING = Object.freeze({ ...IDLE, status: 'loading' } as const);

/**
 * Own an application model for one connection. The initializer and disposer are
 * captured for that lifetime; use a React key to replace its configuration.
 * Native binding changes abort its signal before late work can publish.
 */
export function useEnboxResource<Resource extends Closable>(
  open: (context: EnboxResourceContext) => Resource | Promise<Resource>,
  options: EnboxResourceOptions<Resource> = {},
): EnboxResourceResult<Resource> {
  const { client, controller } = useProviderContext();
  const binding = useConnectionStore(client, selectConnectionBinding, sameConnectionBinding);
  const [version, restart] = useState(0);
  const [owner, replaceOwner] = useState(() => ({ client, binding, version, open, dispose: options.dispose }));
  if (owner.client !== client || !sameConnectionBinding(owner.binding, binding) || owner.version !== version) {
    replaceOwner({ client, binding, version, open, dispose: options.dispose });
  }
  type Attempt = { retired: boolean; stop(): void };
  const [snapshot, publish] = useState<{ owner: object; attempt: Attempt; state: ResourceState<Resource> }>();

  useEffect(() => {
    const { enbox, session } = binding;
    if (enbox === undefined || session === undefined || !isConnectionBindingCurrent(client, binding)) return;
    const lifetime = new AbortController();
    const context: EnboxResourceContext = Object.freeze({ client, enbox, session, signal: lifetime.signal });
    let resource: Resource | undefined;
    let wasPublished = false;
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    let releaseDrain: (() => void) | undefined;
    let retirement: ConnectionSnapshot | undefined;
    const dispose = (value: Resource, published: boolean): void => {
      try {
        const closing = owner.dispose === undefined ? value.close() : owner.dispose(value, {
          ...context, wasPublished: published, snapshot: retirement ?? client.getSnapshot(),
        });
        void Promise.resolve(closing).catch(reportCleanupError);
      } catch (cause) { reportCleanupError(cause); }
    };
    const attempt: Attempt = {
      retired: false,
      stop: (): void => {
        if (attempt.retired) return;
        retirement = client.getSnapshot();
        attempt.retired = true;
        releaseDrain?.();
        lifetime.abort();
        try { unsubscribe?.(); } catch (cause) { reportCleanupError(cause); }
        const closing = resource;
        resource = undefined;
        if (closing !== undefined) dispose(closing, wasPublished);
        if (mounted) publish((current) => current?.attempt === attempt ? { owner, attempt, state: IDLE } : current);
      },
    };
    unsubscribe = subscribeToConnectionBinding(client, binding, () => {
      if (!isConnectionBindingCurrent(client, binding)) attempt.stop();
    });
    if (attempt.retired) unsubscribe();
    publish({ owner, attempt, state: LOADING });
    void Promise.resolve().then(() => {
      lifetime.signal.throwIfAborted();
      return owner.open(context);
    }).then((value) => {
      if (attempt.retired || !isConnectionBindingCurrent(client, binding)) {
        attempt.stop(); dispose(value, false); return;
      }
      resource = value;
      if (value.drain !== undefined) releaseDrain = controller.registerResourceDrain(lifetime.signal, () => value.drain!());
      wasPublished = true;
      publish({ owner, attempt, state: Object.freeze({ status: 'ready', data: value, error: undefined }) });
    }).catch((cause: unknown) => {
      if (attempt.retired) return;
      // Close signal-owned partial initialization while keeping its failure visible.
      lifetime.abort();
      publish({ owner, attempt, state: Object.freeze({ status: 'error', data: undefined, error: toError(cause) }) });
    });
    return () => { mounted = false; attempt.stop(); };
  }, [client, binding, controller, owner]);

  const current = binding.enbox !== undefined && binding.session !== undefined && isConnectionBindingCurrent(client, binding);
  const active = snapshot?.owner === owner && !snapshot.attempt.retired ? snapshot : undefined;
  const retry = useCallback((): void => {
    if (active === undefined || active.attempt.retired || !isConnectionBindingCurrent(client, binding)) return;
    active.attempt.stop();
    restart((previous) => previous + 1);
  }, [active, client, binding]);
  return useMemo(() => Object.freeze({ ...(current ? active?.state ?? LOADING : IDLE), retry }), [current, active, retry]);
}
