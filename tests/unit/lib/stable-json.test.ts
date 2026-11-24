import { sha256Hex } from '../../../src/lib/crypto';
import { stableStringify } from '../../../src/lib/stable-json';

describe('stableStringify', () => {
  it('serialises objects with sorted keys, recursively', () => {
    expect(stableStringify({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it('gives the same fingerprint regardless of key order', () => {
    const one = sha256Hex(stableStringify({ orderType: 'BUY', totalAmount: '100' }));
    const two = sha256Hex(stableStringify({ totalAmount: '100', orderType: 'BUY' }));
    expect(one).toBe(two);
  });

  it('keeps array order (it is meaningful) and handles primitives', () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
  });
});
