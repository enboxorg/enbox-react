import { Blob, Buffer } from 'node:buffer';

import { createEnboxTestContext } from '@enbox/api/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createRecordStore, defineApplicationManifest, defineProtocol, recordCodecs } from '../src/config/index.js';
import { EnboxBindingChangedError, EnboxProvider, useEnboxRecord, useEnboxRecords } from '../src/index.js';
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
    settings: { dataFormats: ['application/json'], encryptionRequired: true },
  },
  structure: { note: {}, settings: { $recordLimit: { max: 1 } }, project: { note: {}, settings: { $recordLimit: { max: 1 } } } },
} as const, {
  project: recordCodecs.json<{ name: string }>(), note: recordCodecs.json<{ title: string; done: boolean }>(),
  settings: recordCodecs.json<{ title: string; done: boolean }>(),
});

describe('singleton commands with a real encrypted DWN', () => {
  it.each([
    { path: 'settings', enabled: true }, { path: 'settings', enabled: false },
    { path: 'project/settings', enabled: true }, { path: 'project/settings', enabled: false },
  ] as const)('observes and mutates $path with observation enabled=$enabled', async ({ path, enabled }) => {
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    try {
      const records = context.enbox.using(protocol).records;
      const within = path === 'settings' ? undefined : (await records.create('project', { data: { name: 'Parent' } })).contextId;
      const other = path === 'settings' ? undefined : await records.set('project/settings', {
        within: (await records.create('project', { data: { name: 'Other' } })).contextId,
        data: { title: 'Other parent', done: false },
      });
      const { client } = controlledClient({ phase: 'connected', enbox: context.enbox, session: context.session });
      const hook = renderHook(() => useEnboxRecord(protocol, path, {
        enabled, ...(within === undefined ? {} : { within }),
      } as never), { wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider> });
      try {
        if (enabled) await waitFor(() => expect(hook.result.current.isMissing).toBe(true));
        else expect(hook.result.current.isMissing).toBe(false);
        let id!: string;
        await act(async () => {
          const created = await hook.result.current.set.mutateAsync({ title: 'First', done: false });
          id = created.id;
          expect(created.record.encryption).toBeDefined();
          const replaced = await hook.result.current.set.mutateAsync({ title: 'Replaced', done: false });
          expect(replaced.id).toBe(id);
          expect(replaced.record.encryption).toBeDefined();
        });
        if (enabled) {
          await waitFor(() => expect(hook.result.current.data?.title).toBe('Replaced'));
          expect(hook.result.current.record?.id).toBe(id);
          expect(hook.result.current.isMissing).toBe(false);
        }
        await act(async () => {
          const updated = await hook.result.current.patch.mutateAsync((current) => ({ title: `${current.title} patched`, done: true }));
          expect(updated.id).toBe(id);
          expect(updated.record.encryption).toBeDefined();
          expect(updated.data).toEqual({ title: 'Replaced patched', done: true });
          await hook.result.current.delete.mutateAsync();
        });
        expect(await records.read(path, { filter: {}, ...(within === undefined ? {} : { within }) })).toBeUndefined();
        if (enabled) await waitFor(() => expect(hook.result.current.isMissing).toBe(true));
        else expect(hook.result.current.status).toBe('idle');
        await act(async () => {
          await expect(hook.result.current.patch.mutateAsync({ title: 'Missing' })).rejects.toMatchObject({ status: { code: 404 } });
          await hook.result.current.delete.mutateAsync();
          const recreated = await hook.result.current.set.mutateAsync({ title: 'New occupant', done: false });
          expect(recreated.id).not.toBe(id);
          const updated = await hook.result.current.patch.mutateAsync({ done: true });
          expect(updated.id).toBe(recreated.id);
        });
        if (other !== undefined) {
          expect(await (await records.read('project/settings', other.id))!.value()).toEqual({ title: 'Other parent', done: false });
        }
      } finally { await act(async () => { hook.unmount(); }); }
    } finally { await context.close(); }
  });
});

describe('explicit record commands with a real encrypted DWN', () => {
  it('shares one catalog between a controller and React without app-side projection or insertion', async () => {
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    const { client } = controlledClient({ phase: 'connected', enbox: context.enbox, session: context.session });
    const store = createRecordStore({ client, protocol, path: 'project/note', options: null, loadAll: true });
    try {
      const parent = await context.enbox.using(protocol).records.create('project', { data: { name: 'Parent' } });
      await store.select({ within: parent.contextId });
      const controllerRows = await store.ready();
      expect(controllerRows.records).toEqual([]);
      const first = renderHook(() => useEnboxRecords(store));
      const second = renderHook(() => useEnboxRecords(store));
      try {
        expect(first.result.current.records).toBe(store.getSnapshot().records);
        expect(second.result.current.records).toBe(first.result.current.records);
        const created = await store.commands.create({ title: 'Controller-created', done: false });
        expect(created.record.encryption).toBeDefined();
        expect(created.data.title).toBe('Controller-created');
        expect((await store.query({ within: parent.contextId })).map((row) => row.id)).toEqual([created.id]);
        await waitFor(() => expect(first.result.current.records[0]?.id).toBe(created.id));
        expect(second.result.current.records).toBe(store.getSnapshot().records);
        await act(async () => { await first.result.current.patch.mutateAsync({ id: created.id, patch: { done: true } }); });
        await waitFor(() => expect(store.getSnapshot().records[0]?.data.done).toBe(true));
        first.unmount();
        await store.commands.delete(created.id);
        await waitFor(() => expect(second.result.current.records).toEqual([]));
      } finally { first.unmount(); second.unmount(); }
    } finally { await store.close(); await context.close(); }
  });

  it('observes native controller writes in independent list and detail queries', async () => {
    const context = await createEnboxTestContext({ application: defineApplicationManifest({ protocols: [protocol] }) });
    try {
      const records = context.enbox.using(protocol).records;
      const parent = await records.create('project', { data: { name: 'Project' } });
      const first = await records.create('project/note', {
        parentContextId: parent.contextId, data: { title: 'In the list', done: false },
      });
      const second = await records.create('project/note', {
        parentContextId: parent.contextId, data: { title: 'Detail only', done: false },
      });
      const { client } = controlledClient({ phase: 'connected', enbox: context.enbox, session: context.session });
      const hook = renderHook(() => ({
        list: useEnboxRecords(protocol, 'project/note', {
          within: parent.contextId, filter: { recordId: first.id }, pagination: { limit: 1 },
        }),
        detail: useEnboxRecord(protocol, 'project/note', { within: parent.contextId, recordId: second.id }),
      }), { wrapper: ({ children }) => <EnboxProvider client={client} initializeOnMount={false}>{children}</EnboxProvider> });
      try {
        await waitFor(() => expect(hook.result.current.list.records.map((row) => row.id)).toEqual([first.id]));
        await waitFor(() => expect(hook.result.current.detail.data?.title).toBe('Detail only'));
        await act(async () => {
          const updated = await records.patch('project/note', second.id, { done: true });
          expect(updated.encryption).toBeDefined();
        });
        await waitFor(() => expect(hook.result.current.detail.data?.done).toBe(true));
        expect(hook.result.current.list.records.map((row) => row.id)).toEqual([first.id]);
        await act(async () => {
          const created = await hook.result.current.list.create.mutateAsync({ title: 'Created through React', done: false });
          expect(created.record.encryption).toBeDefined();
          expect(await (await records.read('project/note', created.id))!.value()).toEqual({ title: 'Created through React', done: false });
          await records.delete('project/note', { recordId: second.id, within: parent.contextId });
        });
        await waitFor(() => expect(hook.result.current.detail.isMissing).toBe(true));
        expect(hook.result.current.list.records.map((row) => row.id)).toEqual([first.id]);
      } finally { await act(async () => { hook.unmount(); }); }
    } finally { await context.close(); }
  });

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
          expect(updated.record.encryption).toBeDefined();
          expect(updated.data).toEqual({ title: 'First updated', done: true });
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
