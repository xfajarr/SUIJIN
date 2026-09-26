import { describe, expect, test } from 'bun:test';
import { BPS, convertAt, curveBaseOut, curveReservesFor, fixedBaseOut, fixedPriceFor, formatUnits, parseUnits, priceOf } from '../src/math';

// Same vectors as contracts/suijin/tests/math_tests.move: TS and Move must agree.
describe('math mirrors Move', () => {
  test('fixed rate converts units', () => expect(fixedBaseOut(10_000_000n, 1n, 150n)).toBe(1_500_000_000n));
  test('fixed rate rounds down', () => expect(fixedBaseOut(7n, 3n, 1n)).toBe(2n));
  test('fixed rate rejects zero price', () => expect(() => fixedBaseOut(10n, 0n, 1n)).toThrow());
  test('curve rounds in favour of maker', () => expect(curveBaseOut(1_000n, 1_000_000n, 1_000_000n, 0n)).toBe(999n));
  test('curve takes fee from input', () => expect(curveBaseOut(10_000n, 1_000_000n, 1_000_000n, 30n)).toBe(9_871n));
  test('curve handles u64 max', () => {
    const max = 18_446_744_073_709_551_615n;
    expect(curveBaseOut(max, max, max, 0n)).toBe(9_223_372_036_854_775_807n);
  });
  test('curve rejects full fee', () => expect(() => curveBaseOut(1n, 1n, 1n, 10_000n)).toThrow());
});

describe('units', () => {
  test('parse', () => expect(parseUnits('10.5')).toBe(10_500_000n));
  test('format', () => expect(formatUnits(1_500_250_000n)).toBe('1,500.25'));
  test('reject junk', () => expect(() => parseUnits('1.2.3')).toThrow());
});

describe('prices across decimals', () => {
  const same = { unitDecimals: 6, pricedDecimals: 6 };
  const suiUsdc = { unitDecimals: 9, pricedDecimals: 6 }; // 1 SUI = P USDC
  const P150 = 150_000_000n; // 150.000000
  const P3_2 = 3_200_000n; // 3.2

  test('fixed, same decimals: 10 tUSD buys 1,500 tJPY at no fee', () => {
    const { priceNum, priceDen } = fixedPriceFor({ ...same, sell: 'priced', price: P150, feeBps: 0n });
    expect(fixedBaseOut(10_000_000n, priceNum, priceDen)).toBe(1_500_000_000n);
  });
  test('fixed matches the old tJPY/tUSD formula', () => {
    const { priceNum, priceDen } = fixedPriceFor({ ...same, sell: 'priced', price: P150, feeBps: 30n });
    const old = { num: 1_000_000n * BPS, den: P150 * (BPS - 30n) };
    expect(priceNum * old.den).toBe(priceDen * old.num);
  });
  test('fixed, 9 vs 6 decimals: 3.2 USDC buys 1 SUI when selling SUI', () => {
    const { priceNum, priceDen } = fixedPriceFor({ ...suiUsdc, sell: 'unit', price: P3_2, feeBps: 0n });
    expect(fixedBaseOut(3_200_000n, priceNum, priceDen)).toBe(1_000_000_000n);
  });
  test('fixed, 9 vs 6 decimals: 1 SUI buys 3.2 USDC when selling USDC', () => {
    const { priceNum, priceDen } = fixedPriceFor({ ...suiUsdc, sell: 'priced', price: P3_2, feeBps: 0n });
    expect(fixedBaseOut(1_000_000_000n, priceNum, priceDen)).toBe(3_200_000n);
  });
  test('fixed fee is a spread in the provider favour', () => {
    const { priceNum, priceDen } = fixedPriceFor({ ...suiUsdc, sell: 'unit', price: P3_2, feeBps: 100n });
    expect(fixedBaseOut(3_200_000n, priceNum, priceDen)).toBeLessThan(1_000_000_000n);
  });
  test('prices stay small enough for u64', () => {
    const { priceNum, priceDen } = fixedPriceFor({ unitDecimals: 9, pricedDecimals: 6, sell: 'priced', price: 123_456_789_000n, feeBps: 30n });
    expect(priceNum < 2n ** 64n && priceDen < 2n ** 64n).toBe(true);
  });
  test('curve starts at the price: 1 SUI buys ~3.2 USDC', () => {
    const r = curveReservesFor({ ...suiUsdc, sell: 'priced', price: P3_2, amount: 1_000_000_000n, depth: 100n });
    const out = curveBaseOut(1_000_000_000n, r.virtualBase, r.virtualQuote, 0n);
    expect(out).toBeGreaterThan(3_150_000n);
    expect(out).toBeLessThanOrEqual(3_200_000n);
  });
  test('curve, same decimals, matches the old formula', () => {
    const r = curveReservesFor({ ...same, sell: 'priced', price: P150, amount: 1_000_000n, depth: 20n });
    expect(r.virtualQuote).toBe((r.virtualBase * 1_000_000n) / P150);
  });
  test('priceOf and convertAt invert each other', () => {
    expect(priceOf({ ...suiUsdc, unitAmount: 1_000_000_000n, pricedAmount: 3_200_000n })).toBe(P3_2);
    expect(convertAt({ ...suiUsdc, price: P3_2, amount: 2_000_000_000n, from: 'unit' })).toBe(6_400_000n);
    expect(convertAt({ ...suiUsdc, price: P3_2, amount: 6_400_000n, from: 'priced' })).toBe(2_000_000_000n);
  });
});
