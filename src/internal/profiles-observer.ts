import type {
  BlobUrlLease, Enbox, ProfileEntryStatus, ProfileFieldSnapshot,
  ProfileReader, ProfileReaderImagesMode, ProfileReaderSource, ProfileSnapshot,
} from '@enbox/browser';
import { createBlobUrlPool, createProfileReader } from '@enbox/browser';
import { reportCleanupError } from './errors.js';
import { EnboxBindingChangedError } from '../errors.js';

export type ResolvedProfile = Readonly<NonNullable<ProfileSnapshot['profile']['value']> & {
  avatarUrl?: string;
  heroUrl?: string;
}>;
export type ProfileSource = ProfileReaderSource | Enbox;
export type ProfileOptions = Readonly<{
  enabled?: boolean;
  /** Eager preserves the convenience default; lazy waits for loadImages(). */
  images?: ProfileReaderImagesMode;
}>;
export type ProfileFieldState = Readonly<Pick<ProfileFieldSnapshot<unknown>, 'status' | 'failure'>>;
export type ProfileResult = ResolvedProfile & Readonly<{
  did: string | undefined;
  /** Status of the fields requested by this consumer. */
  status: ProfileEntryStatus | 'idle';
  /** Native field metadata, including images requested by another consumer. */
  fields: Readonly<{ profile: ProfileFieldState; avatar: ProfileFieldState; hero: ProfileFieldState }>;
  /** Request both images. Rejects when disabled, released, or images are off. */
  loadImages(): Promise<void>;
}>;
type ImageBinding = Readonly<{ blob: Blob; lease: BlobUrlLease }>;
type ProfileBinding = Readonly<{
  snapshot: ProfileSnapshot | undefined;
  imagesRequested: boolean;
  result: ProfileResult;
  avatar: ImageBinding | undefined;
  hero: ImageBinding | undefined;
}>;

const IDLE_FIELD: ProfileFieldState = Object.freeze({ status: 'idle' });
const IDLE_FIELDS = Object.freeze({ profile: IDLE_FIELD, avatar: IDLE_FIELD, hero: IDLE_FIELD });
const rejectRetired = (): Promise<void> => Promise.reject(new EnboxBindingChangedError());
export function idleProfileResult(did?: string): ProfileResult {
  return Object.freeze({ did, status: 'idle', fields: IDLE_FIELDS, loadImages: rejectRetired });
}
const RELEASE_DELAY_MS = 60_000;
let imageUrls: ReturnType<typeof createBlobUrlPool> | undefined;

/** An inert shared reader slot; retained observers can reacquire after Effect cleanup. */
class ProfileResource {
  private reader: ProfileReader | undefined;
  private readonly imageRequests = new Map<string, Promise<void>>();
  private references = 0;
  private generation = 0;

  public constructor(private readonly source: ProfileSource) {}

  public retain(): { reader: ProfileReader; release: () => void } {
    // The native reader accepts Enbox's records surface at runtime; its older
    // optional record metadata declarations differ under exact optional types.
    const reader = this.reader ??= createProfileReader(this.source as ProfileReaderSource, { images: 'lazy' });
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
          this.imageRequests.clear();
          try { reader.dispose(); } catch (cause) { reportCleanupError(cause); }
        }
      });
    } };
  }

  public loadImages(reader: ProfileReader, did: string): Promise<void> {
    const pending = this.imageRequests.get(did);
    if (pending !== undefined) return pending;
    const request = Promise.resolve().then(async () => { await reader.loadImages(did); });
    this.imageRequests.set(did, request);
    const finish = (): void => {
      if (this.imageRequests.get(did) === request) this.imageRequests.delete(did);
    };
    void request.then(finish, finish);
    return request;
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

function fieldState(field: ProfileFieldSnapshot<unknown> | undefined): ProfileFieldState {
  if (field === undefined) return IDLE_FIELD;
  return Object.freeze({ status: field.status,
    ...(field.failure === undefined ? {} : { failure: field.failure }),
  });
}

function sameField(one: ProfileFieldState, two: ProfileFieldState): boolean {
  return one.status === two.status && one.failure === two.failure;
}

function projectedStatus(snapshot: ProfileSnapshot | undefined, imagesRequested: boolean): ProfileResult['status'] {
  if (snapshot === undefined) return 'loading';
  const text = snapshot.profile.status;
  if (!imagesRequested) return text === 'idle' ? 'loading' : text;
  return snapshot.status;
}

/** React consumers own watches and image leases; the resource shares native reads. */
export class ProfilesObserver {
  private readonly listeners = new Set<() => void>();
  private bindings = new Map<string, ProfileBinding>();
  private readonly idleProfiles: ReadonlyMap<string, ProfileResult>;
  private snapshot: ReadonlyMap<string, ProfileResult>;
  private readonly requestedImages = new Set<string>();
  private reader: ProfileReader | undefined;
  private stopWatch: (() => void) | undefined;
  private releaseReader: (() => void) | undefined;
  private active = false;
  private generation = 0;

  public constructor(
    private readonly source: ProfileSource | undefined,
    private readonly dids: readonly string[],
    private readonly images: ProfileReaderImagesMode = 'eager',
  ) {
    this.idleProfiles = new Map(dids.map((did) => [did, idleProfileResult(did)]));
    this.snapshot = this.idleProfiles;
  }

  public readonly getSnapshot = (): ReadonlyMap<string, ProfileResult> => this.snapshot;
  public readonly getServerSnapshot = (): ReadonlyMap<string, ProfileResult> => this.idleProfiles;
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
    this.reader = reader;
    this.releaseReader = release;
    if (this.images === 'eager') for (const did of this.dids) this.requestedImages.add(did);
    try {
      // Native watches emit once per DID during subscription. Read the complete
      // selection once after attachment instead of projecting it for each emit.
      let subscribing = true;
      const stopWatch = reader.watch(this.dids, () => {
        if (!subscribing && this.active && this.generation === generation) this.update(reader);
      });
      subscribing = false;
      if (!this.active || this.generation !== generation) { stopWatch(); return; }
      this.stopWatch = stopWatch;
      this.update(reader);
      if (this.images === 'eager') {
        for (const did of this.dids) void this.loadImages(did, generation).catch(() => {});
      }
    } catch (cause) {
      this.stop();
      throw cause;
    }
  }

  private stop(): void {
    this.active = false;
    this.generation += 1;
    this.reader = undefined;
    this.requestedImages.clear();
    try { this.stopWatch?.(); } catch (cause) { reportCleanupError(cause); }
    this.stopWatch = undefined;
    for (const binding of this.bindings.values()) {
      releaseChanged(binding.avatar); releaseChanged(binding.hero);
    }
    this.bindings.clear();
    this.snapshot = this.idleProfiles;
    this.releaseReader?.();
    this.releaseReader = undefined;
  }

  private async loadImages(did: string, generation: number): Promise<void> {
    const reader = this.reader;
    if (!this.active || this.generation !== generation || reader === undefined || this.source === undefined) {
      throw new EnboxBindingChangedError();
    }
    if (this.images === 'off') throw new TypeError('Profile images are disabled for this consumer.');
    const newlyRequested = !this.requestedImages.has(did);
    this.requestedImages.add(did);
    if (newlyRequested) this.update(reader);
    if (!this.active || this.generation !== generation || this.reader !== reader) throw new EnboxBindingChangedError();
    await resourceFor(this.source).loadImages(reader, did);
    if (this.active && this.generation === generation && this.reader === reader) this.update(reader);
  }

  private update(reader: ProfileReader): void {
    let profiles: Map<string, ProfileResult> | undefined;
    for (const did of this.dids) {
      const snapshot = reader.getSnapshot(did);
      const previous = this.bindings.get(did);
      const imagesRequested = this.requestedImages.has(did);
      if (previous !== undefined && previous.snapshot === snapshot && previous.imagesRequested === imagesRequested) continue;
      const status = projectedStatus(snapshot, imagesRequested);
      const avatar = imageBinding(previous?.avatar, imagesRequested ? snapshot?.avatar.value : undefined);
      const hero = imageBinding(previous?.hero, imagesRequested ? snapshot?.hero.value : undefined);
      releaseChanged(previous?.avatar, avatar); releaseChanged(previous?.hero, hero);
      const projectedFields = Object.freeze({ profile: fieldState(snapshot?.profile),
        avatar: fieldState(snapshot?.avatar), hero: fieldState(snapshot?.hero),
      });
      const fields = previous !== undefined && sameField(previous.result.fields.profile, projectedFields.profile)
        && sameField(previous.result.fields.avatar, projectedFields.avatar)
        && sameField(previous.result.fields.hero, projectedFields.hero)
        ? previous.result.fields : projectedFields;
      const generation = this.generation;
      const result = previous !== undefined && previous.snapshot?.profile.value === snapshot?.profile.value
        && previous.avatar === avatar && previous.hero === hero
        && previous.result.status === status && previous.result.fields === fields
        ? previous.result
        : Object.freeze({ ...snapshot?.profile.value,
          ...(avatar === undefined ? {} : { avatarUrl: avatar.lease.url }),
          ...(hero === undefined ? {} : { heroUrl: hero.lease.url }),
          did, status, fields,
          loadImages: previous?.result.loadImages ?? (() => this.loadImages(did, generation)),
        });
      this.bindings.set(did, { snapshot, imagesRequested, result, avatar, hero });
      if (result !== this.snapshot.get(did)) {
        profiles ??= new Map(this.snapshot);
        profiles.set(did, result);
      }
    }
    if (profiles === undefined) return;
    this.snapshot = profiles;
    for (const listener of this.listeners) listener();
  }
}
