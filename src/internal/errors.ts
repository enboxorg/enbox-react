/** A captured connection workflow or profile subscription is no longer current. */
export class EnboxBindingChangedError extends Error {
  public constructor() {
    super('The Enbox binding has changed. Use the current connection or profile controls.');
    this.name = 'EnboxBindingChangedError';
  }
}

/** Normalize arbitrary failures even when their coercion or instanceof check throws. */
export function toError(cause: unknown): Error {
  try {
    return cause instanceof Error ? cause : new Error(String(cause), { cause });
  } catch {
    // Unknown rejections can have throwing coercion or a revoked Proxy.
    return new Error('An Enbox operation failed.', { cause });
  }
}

/** Cleanup has no mounted consumer to receive its failure. */
export function reportCleanupError(cause: unknown): void {
  console.warn('[@enbox/react] Cleanup failed.', cause);
}
