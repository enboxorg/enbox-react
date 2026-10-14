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
  /** Native field metadata for this consumer's active reader policy. */
  fields: Readonly<{ profile: ProfileFieldState; avatar: ProfileFieldState; hero: ProfileFieldState }>;
  /** Request both images. Rejects when disabled, released, or images are off. */
  loadImages(): Promise<void>;
}>;
type ImageBinding = Readonly<{ blob: Blob; lease: BlobUrlLease }>;
type ProfileBinding = Readonly<{
  snapshot: ProfileSnapshot | undefined;
  profileValue: ProfileSnapshot['profile']['value'];
  imagesRequested: boolean;
  result: ProfileResult;
  avatar: ImageBinding | undefined;
  hero: ImageBinding | undefined;
}>;
type ReaderPolicy = 'off' | 'eager';

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

  public constructor(private readonly source: ProfileSource, private readonly policy: ReaderPolicy) {}

  public retain(): { reader: ProfileReader; release: () => void } {
    // The native reader accepts Enbox's records surface at runtime; its older
    // optional record metadata declarations differ under exact optional types.
    const reader = this.reader ??= createProfileReader(this.source as ProfileReaderSource, { images: this.policy });
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

const resources = new WeakMap<ProfileSource, Map<ReaderPolicy, ProfileResource>>();
function resourceFor(source: ProfileSource, policy: ReaderPolicy): ProfileResource {
  let policies = resources.get(source);
  if (policies === undefined) { policies = new Map(); resources.set(source, policies); }
  let resource = policies.get(policy);
  if (resource === undefined) { resource = new ProfileResource(source, policy); policies.set(policy, resource); }
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
  private imageReader: ProfileReader | undefined;
  private readonly imageWatches = new Map<string, () => void>();
  private stopWatch: (() => void) | undefined;
  private releaseReader: (() => void) | undefined;
  private releaseImageReader: (() => void) | undefined;
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
    const policy = this.images === 'eager' ? 'eager' : 'off';
    const { reader, release } = resourceFor(this.source, policy).retain();
    this.reader = reader;
    this.releaseReader = release;
    try {
      // Native watches emit once per DID during subscription. Read the complete
      // selection once after attachment instead of projecting it for each emit.
      let subscribing = true;
      const stopWatch = reader.watch(this.dids, () => {
        if (!subscribing && this.active && this.generation === generation) this.update();
      });
      subscribing = false;
      if (!this.active || this.generation !== generation) { stopWatch(); return; }
      this.stopWatch = stopWatch;
      this.update();
    } catch (cause) {
      this.stop();
      throw cause;
    }
  }

  private stop(): void {
    this.active = false;
    this.generation += 1;
    this.reader = undefined;
    this.imageReader = undefined;
    this.requestedImages.clear();
    try { this.stopWatch?.(); } catch (cause) { reportCleanupError(cause); }
    this.stopWatch = undefined;
    for (const stop of this.imageWatches.values()) {
      try { stop(); } catch (cause) { reportCleanupError(cause); }
    }
    this.imageWatches.clear();
    for (const binding of this.bindings.values()) {
      releaseChanged(binding.avatar); releaseChanged(binding.hero);
    }
    this.bindings.clear();
    this.snapshot = this.idleProfiles;
    this.releaseReader?.();
    this.releaseReader = undefined;
    this.releaseImageReader?.();
    this.releaseImageReader = undefined;
  }

  private async loadImages(did: string, generation: number): Promise<void> {
    if (!this.active || this.generation !== generation || this.reader === undefined || this.source === undefined) {
      throw new EnboxBindingChangedError();
    }
    if (this.images === 'off') throw new TypeError('Profile images are disabled for this consumer.');
    const reader = this.images === 'lazy' ? this.retainImages(did, generation) : this.reader;
    if (!this.active || this.generation !== generation) throw new EnboxBindingChangedError();
    await resourceFor(this.source, 'eager').loadImages(reader, did);
    if (this.active && this.generation === generation) this.update();
  }

  private retainImages(did: string, generation: number): ProfileReader {
    if (this.imageReader === undefined) {
      const { reader, release } = resourceFor(this.source!, 'eager').retain();
      this.imageReader = reader;
      this.releaseImageReader = release;
    }
    const reader = this.imageReader;
    if (this.requestedImages.has(did)) return reader;
    this.requestedImages.add(did);
    try {
      let subscribing = true;
      const stop = reader.watch([did], () => {
        if (!subscribing && this.active && this.generation === generation && this.imageReader === reader) this.update();
      });
      subscribing = false;
      if (!this.active || this.generation !== generation || this.imageReader !== reader) {
        stop();
        throw new EnboxBindingChangedError();
      }
      this.imageWatches.set(did, stop);
      this.update();
    } catch (cause) {
      if (this.active && this.generation === generation) {
        this.requestedImages.delete(did);
        const stop = this.imageWatches.get(did);
        this.imageWatches.delete(did);
        try { stop?.(); } catch (cleanup) { reportCleanupError(cleanup); }
        if (this.imageWatches.size === 0) {
          this.imageReader = undefined;
          this.releaseImageReader?.();
          this.releaseImageReader = undefined;
        }
        this.update();
      }
      throw cause;
    }
    return reader;
  }

  private update(): void {
    let profiles: Map<string, ProfileResult> | undefined;
    for (const did of this.dids) {
      const imagesRequested = this.images === 'eager' || this.requestedImages.has(did);
      const reader = this.images === 'lazy' && imagesRequested ? this.imageReader : this.reader;
      const snapshot = reader?.getSnapshot(did);
      // Keep already usable text while an explicitly requested image reader
      // settles its own root query; field metadata still comes from that reader.
      const profileValue = snapshot?.profile.value ?? (this.images === 'lazy' && imagesRequested
        && (snapshot === undefined || snapshot.profile.status === 'loading')
        ? this.reader?.getSnapshot(did)?.profile.value : undefined);
      const previous = this.bindings.get(did);
      if (previous !== undefined && previous.snapshot === snapshot && previous.profileValue === profileValue
        && previous.imagesRequested === imagesRequested) continue;
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
      const result = previous !== undefined && previous.profileValue === profileValue
        && previous.avatar === avatar && previous.hero === hero
        && previous.result.status === status && previous.result.fields === fields
        ? previous.result
        : Object.freeze({ ...profileValue,
          ...(avatar === undefined ? {} : { avatarUrl: avatar.lease.url }),
          ...(hero === undefined ? {} : { heroUrl: hero.lease.url }),
          did, status, fields,
          loadImages: previous?.result.loadImages ?? (() => this.loadImages(did, generation)),
        });
      this.bindings.set(did, { snapshot, profileValue, imagesRequested, result, avatar, hero });
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
