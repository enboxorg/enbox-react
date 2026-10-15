import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnboxProvider, useEnboxClient } from '../src/index.js';
import { defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';

const config = { application: defineApplicationManifest({ protocols: [defineProtocol({
  protocol: 'https://owner.test/notes', published: false,
  types: { note: { dataFormats: ['application/json'] } }, structure: { note: {} },
} as const, { note: recordCodecs.json<{ title: string }>() })] }) };

describe('configured provider', () => {
  it('retains one live client through StrictMode replay and disposes it on unmount', async () => {
    const hook = renderHook(useEnboxClient, { reactStrictMode: true,
      wrapper: ({ children }) => <EnboxProvider config={config} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    const client = hook.result.current;
    const dispose = vi.spyOn(client, 'dispose');
    await act(async () => { await Promise.resolve(); });
    expect(dispose).not.toHaveBeenCalled();
    hook.rerender();
    expect(hook.result.current).toBe(client);
    await act(async () => { hook.unmount(); await Promise.resolve(); });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
