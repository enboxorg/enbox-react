'use client';

import type { StoreDefinition, StoreInstance } from '@enbox/browser';
import { useCallback, useSyncExternalStore } from 'react';

import { useApplication } from '../provider.js';

/** Resolve a feature for the current authorization scope without subscribing to its data. */
export function useFeature<Definition extends StoreDefinition>(definition: Definition): StoreInstance<Definition> {
  const application = useApplication();
  const subscribe = useCallback((notify: () => void) => application.subscribe(notify), [application]);
  const getFeature = useCallback(() => application.store(definition), [application, definition]);
  return useSyncExternalStore(subscribe, getFeature, getFeature);
}
