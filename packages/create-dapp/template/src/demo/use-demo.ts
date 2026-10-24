import { useEnboxRecord, useEnboxRecords } from '@enbox/react';
import { DateSort } from '@enbox/react/config';

import { DemoProtocol } from './protocol.js';

export function useSpaces() {
  return useEnboxRecords(DemoProtocol, 'space', { pagination: { limit: 20 }, dateSort: DateSort.CreatedDescending });
}

export function useNotes(within: string | undefined) {
  return useEnboxRecords(DemoProtocol, 'space/note', within === undefined ? null : {
    within, pagination: { limit: 20 },
  });
}

export function useSpaceChoice(within: string | undefined) {
  return useEnboxRecord(DemoProtocol, 'space/choice', within === undefined ? null : { within });
}
