import { describe, expect, it, vi } from 'vitest';

import { serializeQuery } from '../src/internal/serialize-query.js';

describe('record query identity', () => {
  it('normalizes object order and omitted properties while keeping selections distinct', () => {
    const first = serializeQuery({ within: 'parent', filter: { tags: { category: 'work', published: false } } });
    expect(serializeQuery({ filter: { tags: { published: false, category: 'work' } }, unused: undefined, within: 'parent' })).toBe(first);
    expect(serializeQuery({ within: 'other', filter: { tags: { category: 'work', published: false } } })).not.toBe(first);
    expect(serializeQuery({ author: ['a', 'b'] })).not.toBe(serializeQuery({ author: ['b', 'a'] }));
  });

  it.each([NaN, Infinity, new Date(), () => {}, BigInt(1), [undefined]])('rejects unsupported values rather than aliasing them', (value) => {
    expect(() => serializeQuery({ filter: value })).toThrow(TypeError);
  });

  it('rejects cycles and getters without evaluating them', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => serializeQuery(cycle)).toThrow('cycles');
    const getter = (): never => { throw new Error('evaluated'); };
    expect(() => serializeQuery({ get filter() { return getter(); } })).toThrow('getters');
  });

  it('rejects array accessors without evaluating them', () => {
    const getter = vi.fn(() => 'alice');
    const author: string[] = [];
    Object.defineProperty(author, '0', { enumerable: true, get: getter });
    expect(() => serializeQuery({ author })).toThrow('getters');
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects custom array iterators without evaluating them', () => {
    const iterator = vi.fn(() => ['bob'][Symbol.iterator]());
    const author = ['alice'];
    author[Symbol.iterator] = iterator;
    expect(() => serializeQuery({ author })).toThrow('symbol keys');
    expect(iterator).not.toHaveBeenCalled();
  });

  it('rejects sparse arrays and preserves shared acyclic values', () => {
    const shared = { category: 'work' };
    expect(serializeQuery({ first: shared, second: shared })).toBe(
      '{"first":{"category":"work"},"second":{"category":"work"}}',
    );
    expect(() => serializeQuery({ author: new Array(1) })).toThrow('sparse arrays');
  });
});
