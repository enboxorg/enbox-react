import { vi } from 'vitest';

import { defineProtocol, recordCodecs } from '../src/config/index.js';
import { EnboxProvider } from '../src/index.js';
import { connected, ControlledView, controlledClient, facade } from './helpers.js';

export const protocol = defineProtocol({
  protocol: 'https://example.test/scoped-records', published: false,
  types: { space: { dataFormats: ['application/json'] }, note: { dataFormats: ['application/json'] }, choice: { dataFormats: ['application/json'] } },
  structure: { choice: { $recordLimit: { max: 1 } }, space: { note: { choice: { $recordLimit: { max: 1 } } }, choice: { $recordLimit: { max: 1 } } } },
} as const, {
  space: recordCodecs.json<{ name: string }>(), note: recordCodecs.json<{ text: string; done: boolean }>(),
  choice: recordCodecs.json<{ emoji: string }>(),
});

export type Note = { text: string; done: boolean };
export function setup<T = Note>() {
  const view = new ControlledView<{ record: { id: string; contextId: string }; value: T }>();
  const record = (id: string, data: T, contextId = `first/${id}`) => ({
    id, contextId, dateCreated: '2026-01-01T00:00:00.000000Z', timestamp: '2026-01-01T00:00:00.000000Z',
    value: async () => data,
  });
  const api = {
    observe: vi.fn(async (_path: string, _options: unknown) => view),
    query: vi.fn(async (_path: string, _options: unknown): Promise<{ records: { id: string; contextId: string }[] }> => ({ records: [] })),
    create: vi.fn(async (_path: string, request: unknown) => {
      const { data, parentContextId: parent } = request as { data: T; parentContextId?: string };
      return record('created', data, parent === undefined ? 'created' : `${parent}/created`);
    }),
    read: vi.fn(async (path: string, request: string | { filter: object; within?: string }): Promise<{ id: string; contextId: string } | undefined> => {
      const id = typeof request === 'string' ? request : 'singleton';
      const parent = typeof request === 'string' ? path.includes('/') ? 'first' : undefined : request.within;
      return { id, contextId: parent === undefined ? id : `${parent}/${id}` };
    }),
    patch: vi.fn(async (_path: string, id: string, patch: unknown) => record(id, patch as T)),
    delete: vi.fn(async (_path: string, _request: unknown) => {}),
    set: vi.fn(async (_path: string, request: unknown) => {
      const { data, within: parent } = request as { data: T; within?: string };
      return record('singleton', data, parent === undefined ? 'singleton' : `${parent}/singleton`);
    }),
  };
  const lifetime = new AbortController();
  const control = controlledClient(connected(facade(vi.fn(() => ({ records: api }))), 'did:example:alice', lifetime));
  const wrapper = ({ children }: { children: React.ReactNode }) => <EnboxProvider client={control.client}>{children}</EnboxProvider>;
  return { ...control, view, api, wrapper, lifetime, record };
}
