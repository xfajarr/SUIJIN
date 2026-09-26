import { describe, expect, test } from 'bun:test';
import { curveBaseOut, fixedBaseOut, formatUnits, parseUnits } from '../src/math';

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
