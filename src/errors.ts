/** An action's captured session, view, or caller scope is no longer current. */
export class EnboxBindingChangedError extends Error {
  public constructor() {
    super('The Enbox binding has changed. Use the current session or view.');
    this.name = 'EnboxBindingChangedError';
  }
}

/** An active connection is required before invoking an Enbox mutation. */
export class EnboxNotConnectedError extends Error {
  public constructor() {
    super('Connect to Enbox before running a mutation.');
    this.name = 'EnboxNotConnectedError';
  }
}

/** A connection change was stopped to preserve pending application changes. */
export class EnboxResourceDrainError extends Error {
  public constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Pending changes could not be saved.', { cause });
    this.name = 'EnboxResourceDrainError';
  }
}
