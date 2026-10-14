// @vitest-environment node
import { createEnboxTestContext } from '@enbox/api/testing';
import { describe, expect, it, vi } from 'vitest';

import { defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';
import { RecordViewObserver } from '../src/internal/record-view-observer.js';
import { subscribeObserver } from './helpers.js';

const protocol = defineProtocol({
  protocol: 'https://react.example.test/child-materialization/v1', published: false,
  types: {
    note: { dataFormats: ['application/json'], encryptionRequired: true },
    preview: { dataFormats: ['application/json'], encryptionRequired: true },
  },
  structure: { note: { preview: { $recordLimit: { max: 1 } } } },
} as const, {
  note: recordCodecs.json<{ title: string }>(),
  preview: recordCodecs.json<{ body: string }>(),
});

describe('native child materialization through the React record observer', () => {
  it('decodes singleton children and observes their writes and deletion', async () => {
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    const typed = context.enbox.using(protocol);
    const open = (signal: AbortSignal) => typed.records.observe<'note', { children: readonly ['note/preview'] }>('note', {
      pagination: { limit: 10 }, materialize: { children: ['note/preview'] }, signal,
    });
    const observer = new RecordViewObserver(open);
    const stop = subscribeObserver(observer);
    try {
      const note = await typed.records.create('note', { data: { title: 'Parent' } });
      await vi.waitFor(() => expect(observer.getSnapshot().records[0]?.value.title).toBe('Parent'));
      expect(observer.getSnapshot().records[0]?.children.preview).toBeUndefined();

      const preview = await typed.records.set('note/preview', {
        within: note.contextId, data: { body: 'First' },
      });
      await vi.waitFor(() => expect(observer.getSnapshot().records[0]?.children.preview?.value.body).toBe('First'));
      expect(observer.getSnapshot().records[0]?.children.preview?.record.id).toBe(preview.id);

      await typed.records.set('note/preview', { within: note.contextId, data: { body: 'Changed' } });
      await vi.waitFor(() => expect(observer.getSnapshot().records[0]?.children.preview?.value.body).toBe('Changed'));
      await typed.records.delete('note/preview', { recordId: preview.id });
      await vi.waitFor(() => expect(observer.getSnapshot().records[0]?.children.preview).toBeUndefined());
      expect(observer.getSnapshot().records[0]?.value.title).toBe('Parent');
    } finally {
      stop();
      await context.close();
    }
  });

  it.each([
    { children: [] },
    { children: ['note/preview', 'note/preview'] },
    { children: ['preview'] },
    false,
    null,
  ])('publishes native validation failures for malformed JavaScript selection %j', async (materialize) => {
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    const observer = new RecordViewObserver((signal) => context.enbox.using(protocol).records.observe('note', {
      pagination: { limit: 1 }, materialize: materialize as never, signal,
    }));
    const stop = subscribeObserver(observer);
    try {
      await vi.waitFor(() => expect(observer.getSnapshot().status).toBe('error'));
      expect(observer.getSnapshot().error).toBeInstanceOf(TypeError);
      expect(observer.getSnapshot().records).toEqual([]);
    } finally {
      stop();
      await context.close();
    }
  });
});
