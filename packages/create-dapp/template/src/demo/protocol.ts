import { defineProtocol, recordCodecs } from '@enbox/react/config';

import app from '../app.json' with { type: 'json' };

export type Project = { name: string };
export type Task = { title: string; completed: boolean };

// Replace this example URI with one you own before publishing your app.
// Keep it stable after launch: it identifies the app's saved data and grants.
export const DemoProtocol = defineProtocol({
  protocol: `https://example.com/${encodeURIComponent(app.id)}/demo/v2`,
  published: false,
  types: {
    project: { dataFormats: ['application/json'], encryptionRequired: true },
    task: { dataFormats: ['application/json'], encryptionRequired: true },
  },
  structure: { project: { task: {} } },
} as const, {
  project: recordCodecs.json<Project>({ validator: (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && 'name' in value
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 60 }),
  task: recordCodecs.json<Task>({ validator: (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && 'title' in value && 'completed' in value
    && typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 120
    && typeof value.completed === 'boolean' }),
});
