import type { BrowserConnectHandlerOptions, ConnectionStore } from '@enbox/browser';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const requestAccess = vi.fn(async () => undefined);
  const handler = vi.fn((_options: BrowserConnectHandlerOptions) => ({ requestAccess }));
  return { handler, requestAccess };
});
vi.mock('@enbox/browser', async (original) => ({
  ...await original<typeof import('@enbox/browser')>(),
  BrowserConnectHandler: mocks.handler,
}));

import { EnboxProvider, useEnboxConnection } from '../src/index.js';
import { createApplication, defineProtocol, recordCodecs } from '@enbox/browser';

const protocol = defineProtocol({
  protocol: 'https://wallet-options.test/notes', published: false,
  types: { note: { dataFormats: ['application/json'] } }, structure: { note: {} },
} as const, { note: recordCodecs.json<{ title: string }>() });

function captureApproval(client: ConnectionStore): void {
  const snapshot = { phase: 'disconnected' } as const;
  vi.spyOn(client, 'getSnapshot').mockReturnValue(snapshot);
  vi.spyOn(client, 'connect').mockImplementation(async (options) => {
    await options?.connectHandler?.requestAccess({ permissionRequests: [] });
    return snapshot;
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('provider wallet configuration', () => {
  it('inherits the application wallet identity when choosing a wallet', async () => {
    const wallet = { appName: 'Original notes', appIcon: '/original.svg', applicationId: 'notes-id' };
    const application = createApplication({ stores: {}, protocols: [protocol], wallet });
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider application={application} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    captureApproval(application.connection);
    wallet.appName = 'Changed notes';
    wallet.appIcon = '/changed.svg';
    wallet.applicationId = 'changed-id';
    hook.rerender();
    await act(async () => {
      await hook.result.current.connect({ wallet: {
        walletUrl: 'https://chosen-wallet.test', preferredMethod: 'phone',
      } });
    });
    expect(mocks.handler).toHaveBeenLastCalledWith({
      appName: 'Original notes', appIcon: '/original.svg', applicationId: 'notes-id',
      walletUrl: 'https://chosen-wallet.test', preferredMethod: 'phone',
    });
    hook.unmount();
    await application.dispose();
  });

  it('keeps explicit per-call wallet overrides', async () => {
    const application = createApplication({ stores: {}, protocols: [protocol], wallet: { appName: 'Notes', appIcon: '/original.svg' } });
    const client = application.connection;
    captureApproval(client);
    const hook = renderHook(useEnboxConnection, {
      wrapper: ({ children }) => <EnboxProvider application={application} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    await act(async () => {
      await hook.result.current.connect({ wallet: { appName: 'Custom notes', appIcon: '/custom.svg' } });
    });
    expect(mocks.handler).toHaveBeenLastCalledWith({
      appName: 'Custom notes', appIcon: '/custom.svg',
    });
    hook.unmount();
    await application.dispose();
  });
});
