// @vitest-environment node
import { createEnboxTestContext } from '@enbox/api/testing';
import { describe, expect, it, vi } from 'vitest';

import { defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';
import { RecordViewObserver } from '../src/internal/record-view-observer.js';
import { subscribeObserver } from './helpers.js';

describe('real Enbox observed records', () => {
  it('renders encrypted creates, patches, deletes, and pagination through the SDK view', async () => {
    const protocol = defineProtocol({
      protocol: 'https://react.example.test/notes/v1', published: false,
      types: { note: { dataFormats: ['application/json'], encryptionRequired: true } },
      structure: { note: {} },
    } as const, { note: recordCodecs.json<{ title: string }>() });
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    const typed = context.enbox.using(protocol);
    const observer = new RecordViewObserver((signal) => typed.records.observe('note', {
      materialize: true, pagination: { limit: 1 }, signal,
    }));
    const stop = subscribeObserver(observer);
    try {
      await vi.waitFor(() => expect(observer.getSnapshot().status).toBe('ready'));
      const first = await typed.records.create('note', { data: { title: 'First' } });
      await vi.waitFor(() => expect(observer.getSnapshot().records[0]?.value.title).toBe('First'));
      await typed.records.patch('note', first.id, { title: 'Changed' });
      await vi.waitFor(() => expect(observer.getSnapshot().records[0]?.value.title).toBe('Changed'));
      await typed.records.create('note', { data: { title: 'Second' } });
      await vi.waitFor(() => expect(observer.getSnapshot().hasMore).toBe(true));
      await observer.loadMore();
      await vi.waitFor(() => expect(observer.getSnapshot().records).toHaveLength(2));
      await typed.records.delete('note', { recordId: first.id });
      await vi.waitFor(() => expect(observer.getSnapshot().records).toHaveLength(1));
      expect(observer.getSnapshot().records[0]?.value.title).toBe('Second');
      expect(observer.getSnapshot().current).toBe(true);
    } finally {
      stop();
      await context.close();
    }
  });
});
