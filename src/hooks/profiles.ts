'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  idleProfileResult,
  ProfilesObserver,
  type ProfileOptions,
  type ProfileSource,
  type ProfileResult,
} from '../internal/profiles-observer.js';

export type { ProfileFieldState, ProfileOptions, ProfileSource, ProfileResult, ResolvedProfile } from '../internal/profiles-observer.js';

/** Resolve profiles, native settlement state, and leased image URLs. */
export function useProfiles(
  source: ProfileSource | null | undefined,
  dids: readonly string[],
  options: ProfileOptions = {},
): ReadonlyMap<string, ProfileResult> {
  // A DID set keeps its observer when callers reorder or repeat its entries.
  const didSetKey = JSON.stringify([...new Set(dids)].sort());
  const enabled = options.enabled !== false;
  const images = options.images ?? 'eager';
  const observer = useMemo(() => new ProfilesObserver(
    enabled ? source ?? undefined : undefined,
    JSON.parse(didSetKey) as string[],
    images,
  ), [source, didSetKey, enabled, images]);
  return useSyncExternalStore(observer.subscribe, observer.getSnapshot);
}

const EMPTY_PROFILE = idleProfileResult();

/** Resolve one profile; set enabled to false to disable reads. */
export function useProfile(
  source: ProfileSource | null | undefined,
  did: string | undefined,
  options: ProfileOptions = {},
): ProfileResult {
  return useProfiles(source, did ? [did] : [], options).get(did ?? '') ?? EMPTY_PROFILE;
}
