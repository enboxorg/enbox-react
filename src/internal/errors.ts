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
  console.warn('[@enbox/react] Resource cleanup failed.', cause);
}
