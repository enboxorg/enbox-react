import { Blob, Buffer } from 'node:buffer';

import { createEnboxTestContext } from '@enbox/api/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';
import { EnboxBindingChangedError, EnboxProvider, useEnboxRecord } from '../src/index.js';
import { controlledClient } from './helpers.js';

// The Node-only DWN harness needs one binary realm and a standards-complete Blob.
const NativeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as Uint8ArrayConstructor;
beforeAll(() => {
  vi.stubGlobal('Uint8Array', NativeUint8Array);
  vi.stubGlobal('Blob', Blob);
});
afterAll(() => { vi.unstubAllGlobals(); });

const protocol = defineProtocol({
  protocol: 'https://react.example.test/record-commands', published: false,
  types: {
    project: { dataFormats: ['application/json'], encryptionRequired: true },
    note: { dataFormats: ['application/json'], encryptionRequired: true },
  },
  structure: { note: {}, project: { note: {} } },
} as const, {
  project: recordCodecs.json<{ name: string }>(), note: recordCodecs.json<{ title: string; done: boolean }>(),
});

describe('explicit record commands with a real encrypted DWN', () => {
  it.each([
    { path: 'note', enabled: true }, { path: 'note', enabled: false },
    { path: 'project/note', enabled: true }, { path: 'project/note', enabled: false },
  ] as const)('reads and mutates $path with observation enabled=$enabled', async ({ path, enabled }) => {
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    try {
      const records = context.enbox.using(protocol).records;
      const within = path === 'note' ? undefined : (await records.create('project', { data: { name: 'Parent' } })).contextId;
      const created = await records.create(path, {
        data: { title: 'First', done: false }, ...(within === undefined ? {} : { parentContextId: within }),
      });
      const { client } = controlledClient({ phase: 'connected', enbox: context.enbox, session: context.session });
      const hook = renderHook(() => useEnboxRecord(protocol, path, {
        recordId: created.id, enabled, ...(within === undefined ? {} : { within }),
      } as never), { wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider> });
      try {
        expect(created.encryption).toBeDefined();
        if (enabled) await waitFor(() => expect(hook.result.current.data?.title).toBe('First'));
        await act(async () => {
          const updated = await hook.result.current.patch.mutateAsync((current) => ({ title: `${current.title} updated`, done: true }));
          expect(updated.id).toBe(created.id);
          expect(updated.encryption).toBeDefined();
          expect(await updated.data.json()).toEqual({ title: 'First updated', done: true });
        });
        if (enabled) await waitFor(() => expect(hook.result.current.data?.title).toBe('First updated'));
        else expect(hook.result.current.status).toBe('idle');
        const deletion = hook.result.current.delete;
        const completed = vi.fn();
        await act(async () => {
          await deletion.mutateAsync();
          if (deletion.isCurrent()) completed();
        });
        expect(completed).toHaveBeenCalledOnce();
        expect(await records.read(path, created.id)).toBeUndefined();
        if (enabled) await waitFor(() => expect(hook.result.current.data).toBeUndefined());
        await act(async () => {
          await expect(hook.result.current.patch.mutateAsync({ title: 'Missing' })).rejects.toMatchObject({ status: { code: 404 } });
          await hook.result.current.delete.mutateAsync();
        });
      } finally { await act(async () => { hook.unmount(); }); }
    } finally { await context.close(); }
  });

  it('enforces parent boundaries and retires replaced explicit IDs', async () => {
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    try {
      const records = context.enbox.using(protocol).records;
      const first = await records.create('project', { data: { name: 'First' } });
      const other = await records.create('project', { data: { name: 'Other' } });
      const own = await records.create('project/note', { parentContextId: first.contextId, data: { title: 'Own', done: false } });
      const foreign = await records.create('project/note', { parentContextId: other.contextId, data: { title: 'Other', done: false } });
      const { client } = controlledClient({ phase: 'connected', enbox: context.enbox, session: context.session });
      const hook = renderHook(({ recordId }) => useEnboxRecord(protocol, 'project/note', {
        within: first.contextId, recordId, enabled: false,
      }), { initialProps: { recordId: foreign.id },
        wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider> });
      try {
        const retired = hook.result.current.patch;
        await act(async () => {
          await expect(retired.mutateAsync({ title: 'Wrong parent' })).rejects.toThrow('selected parent');
          await expect(hook.result.current.delete.mutateAsync()).rejects.toThrow('selected parent');
        });
        hook.rerender({ recordId: own.id });
        await expect(retired.mutateAsync({ title: 'Stale' })).rejects.toBeInstanceOf(EnboxBindingChangedError);
        await act(async () => {
          await hook.result.current.patch.mutateAsync({ title: 'Updated' });
          await hook.result.current.delete.mutateAsync();
        });
        expect(await records.read('project/note', own.id)).toBeUndefined();
        expect(await (await records.read('project/note', foreign.id))!.data.json()).toEqual({ title: 'Other', done: false });
      } finally { await act(async () => { hook.unmount(); }); }
    } finally { await context.close(); }
  });
});
