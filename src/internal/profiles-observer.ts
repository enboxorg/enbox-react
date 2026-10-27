import type {
  BlobUrlLease, ProfileEntryStatus, ProfileFieldSnapshot,
  ProfileReader, ProfileReaderImagesMode, ProfileReaderSource, ProfileSnapshot,
} from '@enbox/browser';
import { createBlobUrlPool, createProfileReader } from '@enbox/browser';
import { reportCleanupError } from './errors.js';
import { notifyListeners } from './listeners.js';
import { EnboxBindingChangedError } from '../errors.js';

export type ResolvedProfile = Readonly<NonNullable<ProfileSnapshot['profile']['value']> & {
  avatarUrl?: string;
  heroUrl?: string;
}>;
export type ProfileSource = ProfileReaderSource;
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
  /** Request both images; retired or image-disabled consumers cannot start a new request. */
  loadImages(): Promise<void>;
}>;
type ImageBinding = Readonly<{ blob: Blob; lease: BlobUrlLease }>;
type ProfileBinding = Readonly<{
  snapshot: ProfileSnapshot | undefined;
  profileValue: ProfileSnapshot['profile']['value'];
  result: ProfileResult;
  avatar: ImageBinding | undefined;
  hero: ImageBinding | undefined;
}>;
// Lazy consumers share an off reader until they explicitly join the eager pool.
type ReaderPolicy = 'off' | 'eager';

const IDLE_FIELD: ProfileFieldState = Object.freeze({ status: 'idle' });
const IDLE_FIELDS = Object.freeze({ profile: IDLE_FIELD, avatar: IDLE_FIELD, hero: IDLE_FIELD });
const rejectRetired = (): Promise<void> => Promise.reject(new EnboxBindingChangedError());
export function idleProfileResult(did?: string): ProfileResult {
  return Object.freeze({ did, status: 'idle', fields: IDLE_FIELDS, loadImages: rejectRetired });
}
const IMAGE_URL_RELEASE_DELAY_MS = 60_000;
let imageUrlPool: ReturnType<typeof createBlobUrlPool> | undefined;

/** Shares native reads by source and policy; construction acquires no resources. */
class SharedProfileReader {
  private reader: ProfileReader | undefined;
  private references = 0;
  private generation = 0;

  public constructor(
    private readonly source: ProfileSource,
    private readonly policy: ReaderPolicy,
  ) {}

  public retain(): { reader: ProfileReader; release: () => void } {
    const reader = this.reader ??= createProfileReader(this.source, { images: this.policy });
    this.references += 1;
    this.generation += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.references -= 1;
      const generation = ++this.generation;
      // Strict Mode can retain this reader again before deferred disposal runs.
      queueMicrotask(() => {
        if (this.references !== 0 || this.generation !== generation) return;
        this.reader = undefined;
        try {
          reader.dispose();
        } catch (cause) {
          reportCleanupError(cause);
        }
      });
    };
    return { reader, release };
  }
}

const readerResources = new WeakMap<ProfileSource, Map<ReaderPolicy, SharedProfileReader>>();
function sharedReaderFor(source: ProfileSource, policy: ReaderPolicy): SharedProfileReader {
  let policies = readerResources.get(source);
  if (policies === undefined) {
    policies = new Map();
    readerResources.set(source, policies);
  }
  let resource = policies.get(policy);
  if (resource === undefined) {
    resource = new SharedProfileReader(source, policy);
    policies.set(policy, resource);
  }
  return resource;
}

function bindImage(
  previous: ImageBinding | undefined,
  blob: Blob | undefined,
): ImageBinding | undefined {
  if (blob === undefined) return undefined;
  if (previous?.blob === blob) return previous;
  return { blob, lease: (imageUrlPool ??= createBlobUrlPool()).acquire(blob) };
}
function releaseReplacedImage(previous: ImageBinding | undefined, next?: ImageBinding): void {
  if (previous !== undefined && previous !== next) previous.lease.releaseAfter(IMAGE_URL_RELEASE_DELAY_MS);
}

function fieldState(field: ProfileFieldSnapshot<unknown> | undefined): ProfileFieldState {
  if (field === undefined) return IDLE_FIELD;
  return Object.freeze({
    status: field.status,
    ...(field.failure === undefined ? {} : { failure: field.failure }),
  });
}

function sameFieldState(previous: ProfileFieldState, next: ProfileFieldState): boolean {
  return previous.status === next.status && previous.failure === next.failure;
}

/** React consumers own watches and image leases; the resource shares native reads. */
export class ProfilesObserver {
  private readonly listeners = new Set<() => void>();
  private bindings = new Map<string, ProfileBinding>();
  private readonly idleProfiles: ReadonlyMap<string, ProfileResult>;
  private snapshot: ReadonlyMap<string, ProfileResult>;
  private reader: ProfileReader | undefined;
  private lazyImageReader: ProfileReader | undefined;
  private readonly lazyImageWatches = new Map<string, (() => void) | undefined>();
  private stopWatch: (() => void) | undefined;
  private releaseReader: (() => void) | undefined;
  private releaseLazyImageReader: (() => void) | undefined;
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
    const { reader, release } = sharedReaderFor(this.source, policy).retain();
    this.reader = reader;
    this.releaseReader = release;
    try {
      // Native watches emit once per DID during subscription. Read the complete
      // selection once after attachment instead of projecting it for each emit.
      let subscribing = true;
      const stopWatch = reader.watch(this.dids, () => {
        if (!subscribing && this.isCurrent(generation)) this.update();
      });
      subscribing = false;
      if (!this.isCurrent(generation)) {
        stopWatch();
        return;
      }
      this.stopWatch = stopWatch;
      this.update();
    } catch (cause) {
      this.stop();
      throw cause;
    }
  }

  private stop(): void {
    // Detach this lifetime before native cleanup can subscribe a replacement.
    this.active = false;
    this.generation += 1;
    const stopWatch = this.stopWatch;
    const stopImageWatches = [...this.lazyImageWatches.values()];
    const bindings = this.bindings;
    const releaseReader = this.releaseReader;
    const releaseLazyImageReader = this.releaseLazyImageReader;
    this.reader = undefined;
    this.lazyImageReader = undefined;
    this.stopWatch = undefined;
    this.lazyImageWatches.clear();
    this.bindings = new Map();
    this.snapshot = this.idleProfiles;
    this.releaseReader = undefined;
    this.releaseLazyImageReader = undefined;
    try { stopWatch?.(); } catch (cause) { reportCleanupError(cause); }
    for (const stop of stopImageWatches) {
      try { stop?.(); } catch (cause) { reportCleanupError(cause); }
    }
    for (const binding of bindings.values()) {
      releaseReplacedImage(binding.avatar);
      releaseReplacedImage(binding.hero);
    }
    releaseReader?.();
    releaseLazyImageReader?.();
  }

  private isCurrent(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private async loadImages(did: string, generation: number): Promise<void> {
    if (!this.isCurrent(generation) || this.reader === undefined || this.source === undefined) {
      throw new EnboxBindingChangedError();
    }
    if (this.images === 'off') throw new TypeError('Profile images are disabled for this consumer.');
    const reader = this.images === 'lazy' ? this.retainImages(did, generation) : this.reader;
    if (!this.isCurrent(generation)) throw new EnboxBindingChangedError();
    // The native reader coalesces concurrent requests for this DID.
    await Promise.resolve().then(async () => { await reader.loadImages(did); });
    // Retirement fences publication without replacing an already-issued outcome.
    if (this.isCurrent(generation)) this.update();
  }

  private retainImages(did: string, generation: number): ProfileReader {
    if (this.lazyImageReader === undefined) {
      const { reader, release } = sharedReaderFor(this.source!, 'eager').retain();
      this.lazyImageReader = reader;
      this.releaseLazyImageReader = release;
    }
    const reader = this.lazyImageReader;
    if (this.lazyImageWatches.has(did)) return reader;
    // Reserve demand before synchronous watch notifications can reenter loading.
    this.lazyImageWatches.set(did, undefined);
    try {
      let subscribing = true;
      const stop = reader.watch([did], () => {
        if (!subscribing && this.isCurrent(generation) && this.lazyImageReader === reader) this.update();
      });
      subscribing = false;
      if (!this.isCurrent(generation) || this.lazyImageReader !== reader) {
        stop();
        throw new EnboxBindingChangedError();
      }
      this.lazyImageWatches.set(did, stop);
      this.update();
    } catch (cause) {
      if (this.isCurrent(generation)) {
        const stop = this.lazyImageWatches.get(did);
        this.lazyImageWatches.delete(did);
        try { stop?.(); } catch (cleanup) { reportCleanupError(cleanup); }
        if (![...this.lazyImageWatches.values()].some((stop) => stop !== undefined)) {
          this.lazyImageReader = undefined;
          this.releaseLazyImageReader?.();
          this.releaseLazyImageReader = undefined;
        }
        this.update();
      }
      throw cause;
    }
    return reader;
  }

  private update(): void {
    let nextProfiles: Map<string, ProfileResult> | undefined;
    for (const did of this.dids) {
      const imagesRequested = this.images === 'eager' || this.lazyImageWatches.has(did);
      const reader = this.images === 'lazy' && imagesRequested ? this.lazyImageReader : this.reader;
      const snapshot = reader?.getSnapshot(did);
      // Keep already usable text while an explicitly requested image reader
      // settles its own root query; field metadata still comes from that reader.
      const profileValue = snapshot?.profile.value ?? (this.images === 'lazy' && imagesRequested
        && (snapshot === undefined || snapshot.profile.status === 'loading')
        ? this.reader?.getSnapshot(did)?.profile.value : undefined);
      const previous = this.bindings.get(did);
      if (previous !== undefined && previous.snapshot === snapshot && previous.profileValue === profileValue) continue;
      // The selected native reader already applies this consumer's image policy.
      const status = snapshot?.status ?? 'loading';
      const avatar = bindImage(previous?.avatar, snapshot?.avatar.value);
      const hero = bindImage(previous?.hero, snapshot?.hero.value);
      releaseReplacedImage(previous?.avatar, avatar);
      releaseReplacedImage(previous?.hero, hero);
      const projectedFields = Object.freeze({
        profile: fieldState(snapshot?.profile),
        avatar: fieldState(snapshot?.avatar),
        hero: fieldState(snapshot?.hero),
      });
      const unchangedFields = previous !== undefined && sameFieldState(previous.result.fields.profile, projectedFields.profile)
        && sameFieldState(previous.result.fields.avatar, projectedFields.avatar)
        && sameFieldState(previous.result.fields.hero, projectedFields.hero);
      const fields = unchangedFields ? previous.result.fields : projectedFields;
      const generation = this.generation;
      // Native snapshots can change without changing the exposed React result.
      const unchangedResult = previous !== undefined && previous.profileValue === profileValue
        && previous.avatar === avatar && previous.hero === hero
        && previous.result.status === status && previous.result.fields === fields;
      const result = unchangedResult ? previous.result : Object.freeze({
        ...profileValue,
        ...(avatar === undefined ? {} : { avatarUrl: avatar.lease.url }),
        ...(hero === undefined ? {} : { heroUrl: hero.lease.url }),
        did,
        status,
        fields,
        loadImages: previous?.result.loadImages ?? (() => this.loadImages(did, generation)),
      });
      this.bindings.set(did, { snapshot, profileValue, result, avatar, hero });
      if (result !== this.snapshot.get(did)) {
        nextProfiles ??= new Map(this.snapshot);
        nextProfiles.set(did, result);
      }
    }
    if (nextProfiles === undefined) return;
    this.snapshot = nextProfiles;
    notifyListeners(this.listeners);
  }
}
