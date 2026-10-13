import type { BlobUrlLease, Enbox, ProfileReader, ProfileReaderSource, ProfileSnapshot } from '@enbox/browser';
import { createBlobUrlPool, createProfileReader } from '@enbox/browser';
import { reportCleanupError } from './errors.js';

export type ResolvedProfile = Readonly<NonNullable<ProfileSnapshot['profile']['value']> & {
  avatarUrl?: string;
  heroUrl?: string;
}>;
export type ProfileSource = ProfileReaderSource | Enbox;
type ImageBinding = Readonly<{ blob: Blob; lease: BlobUrlLease }>;
type ProfileBinding = Readonly<{ profile: ResolvedProfile; avatar: ImageBinding | undefined; hero: ImageBinding | undefined }>;

const EMPTY_PROFILES: ReadonlyMap<string, ResolvedProfile> = new Map();
const RELEASE_DELAY_MS = 60_000;
let imageUrls: ReturnType<typeof createBlobUrlPool> | undefined;

/** An inert shared reader slot; retained observers can reacquire after Effect cleanup. */
class ProfileResource {
  private reader: ProfileReader | undefined;
  private references = 0;
  private generation = 0;

  public constructor(private readonly source: ProfileSource) {}

  public retain(): { reader: ProfileReader; release: () => void } {
    // The native reader accepts Enbox's records surface at runtime; its older
    // optional record metadata declarations differ under exact optional types.
    const reader = this.reader ??= createProfileReader(this.source as ProfileReaderSource, { images: 'eager' });
    this.references += 1;
    this.generation += 1;
    let released = false;
    return { reader, release: () => {
      if (released) return;
      released = true;
      this.references -= 1;
      const generation = ++this.generation;
      queueMicrotask(() => {
        if (this.references === 0 && this.generation === generation) {
          this.reader = undefined;
          try { reader.dispose(); } catch (cause) { reportCleanupError(cause); }
        }
      });
    } };
  }
}

const resources = new WeakMap<ProfileSource, ProfileResource>();
function resourceFor(source: ProfileSource): ProfileResource {
  let resource = resources.get(source);
  if (resource === undefined) { resource = new ProfileResource(source); resources.set(source, resource); }
  return resource;
}

function imageBinding(previous: ImageBinding | undefined, blob: Blob | undefined): ImageBinding | undefined {
  if (blob === undefined) return undefined;
  if (previous?.blob === blob) return previous;
  return { blob, lease: (imageUrls ??= createBlobUrlPool()).acquire(blob) };
}
function releaseChanged(previous: ImageBinding | undefined, next?: ImageBinding): void {
  if (previous !== undefined && previous !== next) previous.lease.releaseAfter(RELEASE_DELAY_MS);
}

/** React consumers own watches and image leases; the resource shares native reads. */
export class ProfilesObserver {
  private readonly listeners = new Set<() => void>();
  private bindings = new Map<string, ProfileBinding>();
  private snapshot = EMPTY_PROFILES;
  private stopWatch: (() => void) | undefined;
  private releaseReader: (() => void) | undefined;
  private active = false;
  private generation = 0;

  public constructor(private readonly source: ProfileSource | undefined, private readonly dids: readonly string[]) {}

  public readonly getSnapshot = (): ReadonlyMap<string, ResolvedProfile> => this.snapshot;
  public readonly getServerSnapshot = (): ReadonlyMap<string, ResolvedProfile> => EMPTY_PROFILES;
  public readonly subscribe = (notify: () => void): (() => void) => {
    const listener = (): void => { notify(); };
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0) this.stop();
    };
  };

  private start(): void {
    if (this.source === undefined || this.dids.length === 0) return;
    this.active = true;
    const generation = ++this.generation;
    const { reader, release } = resourceFor(this.source).retain();
    this.releaseReader = release;
    try {
      const stopWatch = reader.watch(this.dids, () => {
        if (this.active && this.generation === generation) this.update(reader);
      });
      if (!this.active || this.generation !== generation) { stopWatch(); return; }
      this.stopWatch = stopWatch;
      this.update(reader);
    } catch (cause) {
      this.stop();
      throw cause;
    }
  }

  private stop(): void {
    this.active = false;
    this.generation += 1;
    try { this.stopWatch?.(); } catch (cause) { reportCleanupError(cause); }
    this.stopWatch = undefined;
    for (const binding of this.bindings.values()) {
      releaseChanged(binding.avatar); releaseChanged(binding.hero);
    }
    this.bindings.clear();
    this.snapshot = EMPTY_PROFILES;
    this.releaseReader?.();
    this.releaseReader = undefined;
  }

  private update(reader: ProfileReader): void {
    const profiles = new Map<string, ResolvedProfile>();
    for (const did of this.dids) {
      const snapshot = reader.getSnapshot(did);
      const previous = this.bindings.get(did);
      const avatar = imageBinding(previous?.avatar, snapshot?.avatar.value);
      const hero = imageBinding(previous?.hero, snapshot?.hero.value);
      releaseChanged(previous?.avatar, avatar); releaseChanged(previous?.hero, hero);
      const profile = Object.freeze({ ...snapshot?.profile.value,
        ...(avatar === undefined ? {} : { avatarUrl: avatar.lease.url }),
        ...(hero === undefined ? {} : { heroUrl: hero.lease.url }),
      });
      this.bindings.set(did, { profile, avatar, hero });
      profiles.set(did, profile);
    }
    this.snapshot = profiles;
    for (const listener of this.listeners) listener();
  }
}
