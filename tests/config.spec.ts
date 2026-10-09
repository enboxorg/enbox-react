// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AuthManager } from '@enbox/browser';
import { createEnboxClient, defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';

const application = defineApplicationManifest({ protocols: [defineProtocol({
  protocol: 'https://example.test/notes', published: false,
  types: { note: { dataFormats: ['application/json'] } }, structure: { note: {} },
} as const, { note: recordCodecs.json<{ title: string }>() })] });

describe('config entrypoint', () => {
  it('constructs and disposes without browser globals or creating an AuthManager', async () => {
    expect(typeof window).toBe('undefined');
    const create = vi.spyOn(AuthManager, 'create');
    try {
      const client = createEnboxClient({ application, wallet: { appName: 'Notes', appIcon: '/icon.svg' } });
      expect(client.getSnapshot().phase).toBe('initializing');
      expect(create).not.toHaveBeenCalled();
      await client.dispose();
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it('rejects runtime configuration that would hide or override native ownership', () => {
    expect(() => createEnboxClient({ application, connection: { auth: {} } } as never)).toThrow('connection.auth');
    expect(() => createEnboxClient({ application, wallet: {}, connectHandler: {} } as never)).toThrow('not both');
  });
});
