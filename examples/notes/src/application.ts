import type { RecordValidator } from '@enbox/react/config';

import { defineApplicationManifest, defineProtocol, recordCodecs } from '@enbox/react/config';

export type Note = { title: string };

// A small domain validator. Larger apps can use Enbox's standalone codegen.
const validateNote: RecordValidator = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object' || !('title' in value)) return false;
  return typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 500;
};

export const NotesProtocol = defineProtocol({
  protocol: 'https://example.com/enbox-react/notes/v1',
  published: false,
  types: {
    note: { dataFormats: ['application/json'], encryptionRequired: true },
  },
  structure: { note: {} },
} as const, { note: recordCodecs.json<Note>({ validator: validateNote }) });

export const application = defineApplicationManifest({ protocols: [NotesProtocol] });
