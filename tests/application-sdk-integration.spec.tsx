import type { TypedMaterializedRecord } from '@enbox/api';

import { createApplication, defineApplication, defineProtocol, defineStore, recordCodecs } from '@enbox/api';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnboxProvider, useFeature, useStore } from '../src/index.js';
import { connected, ControlledView, controlledClient, facade } from './helpers.js';

type Note = { title: string };
const NotesProtocol = defineProtocol({
  protocol: 'https://application-react.test/notes', published: false,
  types: { note: { dataFormats: ['application/json'] } },
  structure: { note: {} },
} as const, { note: recordCodecs.json<Note>() });
const NotesStore = defineStore({
  protocols: { notes: NotesProtocol },
  create: ({ protocols }) => ({ notes: protocols.notes.collection('note') }),
});
const definition = defineApplication({ stores: { notes: NotesStore } });

describe('native application React integration', () => {
  it('shares one native observation and retires the exact authorization generation', async () => {
    const views: ControlledView<TypedMaterializedRecord<Note>>[] = [];
    const open = vi.fn(async () => {
      const view = new ControlledView<TypedMaterializedRecord<Note>>();
      views.push(view);
      return view;
    });
    const enbox = facade(vi.fn(() => ({ records: { observe: open } })));
    const connection = controlledClient(connected(enbox));
    const application = createApplication(definition, { connection: connection.client });
    const hook = renderHook(() => {
      const first = useFeature(NotesStore);
      const second = useFeature(NotesStore);
      return { first, second, firstState: useStore(first.notes), secondState: useStore(second.notes) };
    }, {
      reactStrictMode: true,
      wrapper: ({ children }) => <EnboxProvider application={application} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    try {
      await waitFor(() => expect(hook.result.current.firstState.status).toBe('ready'));
      expect(hook.result.current.first).toBe(hook.result.current.second);
      expect(open).toHaveBeenCalledOnce();
      const previous = hook.result.current.first;
      act(() => connection.publish({ ...connection.client.getSnapshot() }));
      expect(hook.result.current.first).toBe(previous);
      act(() => connection.publish(connected(enbox)));
      await waitFor(() => expect(hook.result.current.firstState.status).toBe('ready'));
      expect(hook.result.current.first).not.toBe(previous);
      expect(hook.result.current.first).toBe(hook.result.current.second);
      expect(open).toHaveBeenCalledTimes(2);
      await expect(previous.notes.create.run({ title: 'Retired' })).rejects.toMatchObject({ name: 'StoreRetiredError' });
      await waitFor(() => expect(views[0]?.close).toHaveBeenCalledOnce());
    } finally {
      hook.unmount();
      await application.dispose();
    }
    expect(views.every((view) => view.close.mock.calls.length === 1)).toBe(true);
  });

  it('resolves an inactive feature when the session aborts before its connection snapshot changes', async () => {
    const lifetime = new AbortController();
    const open = vi.fn(async () => new ControlledView<TypedMaterializedRecord<Note>>());
    const connection = controlledClient(connected(facade(vi.fn(() => ({ records: { observe: open } }))), undefined, lifetime));
    const application = createApplication(definition, { connection: connection.client });
    const hook = renderHook(() => {
      const feature = useFeature(NotesStore);
      return { feature, state: useStore(feature.notes) };
    }, {
      wrapper: ({ children }) => <EnboxProvider application={application} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    try {
      await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
      const previous = hook.result.current.feature;
      const nativeSnapshot = connection.client.getSnapshot();
      act(() => lifetime.abort());
      expect(connection.client.getSnapshot()).toBe(nativeSnapshot);
      expect(hook.result.current.feature).not.toBe(previous);
      expect(hook.result.current.state.status).toBe('idle');
      expect(open).toHaveBeenCalledOnce();
    } finally {
      hook.unmount();
      await application.dispose();
    }
  });
});
