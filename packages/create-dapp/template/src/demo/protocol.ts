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

const validateChoice: RecordValidator = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && 'emoji' in value && CHOICES.some(({ emoji }) => emoji === value.emoji);

// Replace this example URI with one you own before publishing your app.
// Keep it stable after launch: it identifies the app's saved data and grants.
export const DemoProtocol = defineProtocol({
  protocol: `https://example.com/${encodeURIComponent(app.id)}/demo/v1`,
  published: false,
  types: {
    choice: { dataFormats: ['application/json'], encryptionRequired: true },
  },
  structure: { choice: { $recordLimit: { max: 1 } } },
} as const, { choice: recordCodecs.json<Choice>({ validator: validateChoice }) });
