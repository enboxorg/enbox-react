'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { ProfilesObserver, type ProfileSource, type ResolvedProfile } from '../internal/profiles-observer.js';

export type { ProfileSource, ResolvedProfile } from '../internal/profiles-observer.js';

/** Resolve public profiles with shared native reads and managed image URLs. */
export function useProfiles(source: ProfileSource | null | undefined, dids: readonly string[]): ReadonlyMap<string, ResolvedProfile> {
  const key = JSON.stringify([...new Set(dids)].sort());
  const observer = useMemo(() => new ProfilesObserver(source ?? undefined, JSON.parse(key) as string[]), [source, key]);
  return useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getServerSnapshot);
}

const EMPTY_PROFILE: ResolvedProfile = Object.freeze({});
export function useProfile(source: ProfileSource | null | undefined, did: string | undefined, enabled = true): ResolvedProfile {
  return useProfiles(source, enabled && did ? [did] : []).get(did ?? '') ?? EMPTY_PROFILE;
}
