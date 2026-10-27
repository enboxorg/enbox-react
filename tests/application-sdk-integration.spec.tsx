import type { TypedMaterializedRecord } from '@enbox/browser';

import { createApplication, defineProtocol, defineStore, recordCodecs } from '@enbox/browser';
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

const NotebookProtocol = defineProtocol({
  protocol: 'https://application-react.test/notebooks', published: false,
  types: { notebook: { dataFormats: ['application/json'] }, note: { dataFormats: ['application/json'] } },
  structure: { notebook: { note: {} } },
} as const, { notebook: recordCodecs.json<{ name: string }>(), note: recordCodecs.json<Note>() });
const NotebookStore = defineStore({
  protocols: { notebooks: NotebookProtocol },
  create({ protocols, resource }) {
    const notes = protocols.notebooks.collection('notebook/note');
    return { notes, activeNotes: resource({ selection: null, source: (parent: string) => notes.within(parent) }) };
  },
});

describe('native application React integration', () => {
  it('reads selected parent and rows together and retires the binding with its session', async () => {
    type Row = { record: { id: string; contextId: string }; value: Note };
    const views = new Map<string, ControlledView<Row>>();
    const open = vi.fn(async (_path: string, options: { within: string }) => {
      const view = new ControlledView<Row>([{
        record: { id: `${options.within}-note`, contextId: `${options.within}/${options.within}-note` },
        value: { title: options.within },
      }]);
      views.set(options.within, view);
      return view;
    });
    const enbox = facade(vi.fn(() => ({ records: { observe: open } })));
    const connection = controlledClient(connected(enbox));
    const application = createApplication({ stores: { notebooks: NotebookStore }, connection: () => connection.client });
    const hook = renderHook(() => {
      const feature = useFeature(NotebookStore);
      return { feature, state: useStore(feature.activeNotes) };
    }, {
      reactStrictMode: true,
      wrapper: ({ children }) => <EnboxProvider application={application} initializeOnMount={false}>{children}</EnboxProvider>,
    });
    let releaseBackground: (() => void) | undefined;
    try {
      expect(hook.result.current.state.selection).toBeNull();
      expect(hook.result.current.state.status).toBe('idle');
      expect(open).not.toHaveBeenCalled();
      const firstFeature = hook.result.current.feature;
      await act(async () => { await firstFeature.activeNotes.select('first'); });
      expect(hook.result.current.state.selection).toBe('first');
      expect(hook.result.current.state.records?.[0]?.value.title).toBe('first');
      const background = firstFeature.notes.within('first');
      releaseBackground = background.retain();
      const backgroundState = await background.ready();
      expect(hook.result.current.state.records).toBe(backgroundState.records);
      expect(open).toHaveBeenCalledOnce();

      await act(async () => { await firstFeature.activeNotes.select('second'); });
      expect(hook.result.current.state.selection).toBe('second');
      expect(hook.result.current.state.records?.[0]?.value.title).toBe('second');
      expect(views.get('first')?.close).not.toHaveBeenCalled();
      act(() => views.get('first')?.publish({
        status: 'ready', current: true, hasMore: false,
        records: [{ record: { id: 'late', contextId: 'first/late' }, value: { title: 'Late first' } }],
      }));
      expect(hook.result.current.state.selection).toBe('second');
      expect(hook.result.current.state.records?.[0]?.value.title).toBe('second');

      act(() => connection.publish(connected(enbox)));
      expect(hook.result.current.feature).not.toBe(firstFeature);
      expect(hook.result.current.state.selection).toBeNull();
      expect(hook.result.current.state.status).toBe('idle');
      expect(hook.result.current.state.records ?? []).toEqual([]);
      await expect(firstFeature.activeNotes.select('first')).rejects.toMatchObject({ name: 'StoreRetiredError' });
      await waitFor(() => expect([...views.values()].every(view => view.close.mock.calls.length === 1)).toBe(true));
    } finally {
      releaseBackground?.();
      hook.unmount();
      await application.dispose();
    }
  });

  it('shares one native observation and retires the exact authorization scope', async () => {
    const views: ControlledView<TypedMaterializedRecord<Note>>[] = [];
    const open = vi.fn(async () => {
      const view = new ControlledView<TypedMaterializedRecord<Note>>();
      views.push(view);
      return view;
    });
    const enbox = facade(vi.fn(() => ({ records: { observe: open } })));
    const connection = controlledClient(connected(enbox));
    const application = createApplication({ stores: { notes: NotesStore }, connection: () => connection.client });
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
    const application = createApplication({ stores: { notes: NotesStore }, connection: () => connection.client });
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
