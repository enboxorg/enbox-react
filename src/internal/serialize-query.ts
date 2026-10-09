/** Serializes query data deterministically without evaluating accessors. */
export function serializeQuery(value: unknown): string {
  const visiting = new Set<object>();

  function readProperty(input: object, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined) {
      throw new TypeError('Record queries cannot contain sparse arrays.');
    }
    if (!('value' in descriptor)) {
      throw new TypeError('Record queries cannot contain getters.');
    }
    return descriptor.value;
  }

  function normalize(input: unknown): unknown {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null) {
      throw new TypeError('Record queries support plain JSON values and finite numbers.');
    }
    if (visiting.has(input)) throw new TypeError('Record queries cannot contain cycles.');
    visiting.add(input);
    try {
      if (Object.getOwnPropertySymbols(input).length !== 0) {
        throw new TypeError('Record queries cannot contain symbol keys.');
      }
      if (Array.isArray(input)) {
        const values: unknown[] = [];
        for (let index = 0; index < input.length; index += 1) {
          values.push(normalize(readProperty(input, String(index))));
        }
        return values;
      }
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Record queries must use plain objects.');
      }
      const entries: [string, unknown][] = [];
      for (const key of Object.keys(input).sort()) {
        const child = readProperty(input, key);
        if (child !== undefined) entries.push([key, normalize(child)]);
      }
      return Object.fromEntries(entries);
    } finally {
      visiting.delete(input);
    }
  }
  return JSON.stringify(normalize(value));
}
