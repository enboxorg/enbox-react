import { defineProtocol, recordCodecs } from '@enbox/react/config';
import type { RecordValidator } from '@enbox/react/config';

import app from '../app.json' with { type: 'json' };

export const CHOICES = [
  { emoji: '🌱', label: 'Grow' },
  { emoji: '✨', label: 'Spark' },
  { emoji: '🚀', label: 'Explore' },
] as const;

export type ChoiceEmoji = typeof CHOICES[number]['emoji'];
export type Choice = { emoji: ChoiceEmoji };
export type Space = { name: string };
export type Note = { text: string; done: boolean };

const validateChoice: RecordValidator = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && 'emoji' in value && CHOICES.some(({ emoji }) => emoji === value.emoji);

// Replace this example URI with one you own before publishing your app.
// Keep it stable after launch: it identifies the app's saved data and grants.
export const DemoProtocol = defineProtocol({
  protocol: `https://example.com/${encodeURIComponent(app.id)}/demo/v2`,
  published: false,
  types: {
    space: { dataFormats: ['application/json'], encryptionRequired: true },
    note: { dataFormats: ['application/json'], encryptionRequired: true },
    choice: { dataFormats: ['application/json'], encryptionRequired: true },
  },
  structure: { space: { note: {}, choice: { $recordLimit: { max: 1 } } } },
} as const, {
  space: recordCodecs.json<Space>({ validator: (value: unknown) =>
    value !== null && typeof value === 'object' && 'name' in value
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 60 }),
  note: recordCodecs.json<Note>({ validator: (value: unknown) =>
    value !== null && typeof value === 'object' && 'text' in value && 'done' in value
    && typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 200
    && typeof value.done === 'boolean' }),
  choice: recordCodecs.json<Choice>({ validator: validateChoice }),
});
