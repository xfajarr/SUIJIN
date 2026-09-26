import { describe, expect, test } from 'bun:test';
import { curveBaseOut, curveQuoteInFor, fixedBaseOut, fixedQuoteInFor } from '../src/math';

// Exact-output quotes (Pay): the smallest input whose forward output reaches the target.
describe('inverse quotes', () => {
  test('fixed: 1,500 tJPY at 150 per tUSD costs exactly 10 tUSD', () => {
    const q = fixedQuoteInFor(1_500_000_000n, 1n, 150n);
    expect(q).toBe(10_000_000n);
    expect(fixedBaseOut(q, 1n, 150n)).toBe(1_500_000_000n);
  });

  test('fixed: rounds the input up, never short-changes the recipient', () => {
    const q = fixedQuoteInFor(2n, 3n, 1n);
    expect(q).toBe(6n);
    expect(fixedBaseOut(q - 1n, 3n, 1n)).toBe(1n);
  });

  test('curve: minimal input, checked against the forward formula', () => {
    const [vb, vq, fee] = [1_000_000_000_000n, 6_666_666_666n, 30n];
    for (const out of [1n, 1_000_000n, 1_500_000_000n, 250_000_000_000n]) {
      const q = curveQuoteInFor(out, vb, vq, fee);
      expect(q).not.toBeNull();
      expect(curveBaseOut(q!, vb, vq, fee) >= out).toBe(true);
      expect(curveBaseOut(q! - 1n, vb, vq, fee) < out).toBe(true);
    }
  });

  test('curve: the whole reserve can never be bought', () => {
    expect(curveQuoteInFor(1_000_000n, 1_000_000n, 1_000_000n, 30n)).toBeNull();
  });
});
