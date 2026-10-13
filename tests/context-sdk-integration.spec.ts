// @vitest-environment node
import { createEnboxTestContext } from '@enbox/api/testing';
import { describe, expect, it, vi } from 'vitest';

import { createContextStore } from '../src/config/context-store.js';
import { defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';

describe('real Enbox context catalogs', () => {
  it('observes local owned contexts through the shared adapter', async () => {
    const protocol = defineProtocol({
      protocol: 'https://react.example.test/context-catalog/v1', published: false,
      types: {
        notebook: { dataFormats: ['application/json'], encryptionRequired: true },
        member: { dataFormats: ['application/json'] },
      },
      structure: { notebook: {
        $actions: [{ role: 'notebook/member', can: ['read'] }], member: { $role: true },
      } },
    } as const, {
      notebook: recordCodecs.json<{ title: string }>(), member: recordCodecs.json<{ label: string }>(),
    }, { roleGroups: { default: ['notebook/member'] } });
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    const typed = context.enbox.using(protocol);
    const store = createContextStore((signal) => typed.contexts.observe({ signal }));
    try {
      await store.ready();
      expect(store.getSnapshot().contexts).toEqual([]);
      const notebook = await typed.records.create('notebook', { data: { title: 'Local notebook' } });
      await vi.waitFor(() => expect(store.getSnapshot().contexts).toHaveLength(1));
      expect(store.getSnapshot().contexts[0]).toMatchObject({
        access: 'owner', path: 'notebook', rootRecordId: notebook.id,
      });
      await store.retry();
      await store.ready();
      expect(store.getSnapshot().contexts[0]?.rootRecordId).toBe(notebook.id);
      await typed.records.delete('notebook', { recordId: notebook.id });
      await vi.waitFor(() => expect(store.getSnapshot().contexts).toEqual([]));
    } finally {
      await store.close();
      await context.close();
    }
  });
});
