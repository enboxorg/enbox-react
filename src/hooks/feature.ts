'use client';

import type { StoreDefinition, StoreInstance } from '@enbox/browser';
import { useCallback, useSyncExternalStore } from 'react';

import { useApplication } from '../provider.js';

/**
 * Resolve the same session-owned feature instance as application.store(definition).
 * React observes instance replacement when the native session or Enbox facade
 * changes. Read its resource and command state with useStore; resolving the
 * feature alone does not retain or open those resources.
 * Its resources stay idle before a usable connection exists.
 * Requires an EnboxProvider.
 */
export function useFeature<Definition extends StoreDefinition>(definition: Definition): StoreInstance<Definition> {
  const application = useApplication();
  const subscribe = useCallback((notify: () => void) => application.subscribe(notify), [application]);
  // Scope invalidation can precede a connection publication, so observe feature identity directly.
  const getFeature = useCallback(() => application.store(definition), [application, definition]);
  return useSyncExternalStore(subscribe, getFeature, getFeature);
}
