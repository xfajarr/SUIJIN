import { expect, test } from 'bun:test';
import { cleanAmount, fmt, parseAmount, rate, toInput, until } from '../src/format';

test('typing: digits and one dot, at most 6 decimals, commas are grouping', () => {
  expect(cleanAmount('1,500.25')).toBe('1500.25');
  expect(cleanAmount('1.2.3')).toBe('1.23');
  expect(cleanAmount('0.1234567')).toBe('0.123456');
  expect(cleanAmount('abc12')).toBe('12');
});

test('parse: empty or invalid is null, ".5" works', () => {
  expect(parseAmount('')).toBeNull();
  expect(parseAmount('.')).toBeNull();
  expect(parseAmount('.5')).toBe(500_000n);
  expect(parseAmount('10.')).toBe(10_000_000n);
  expect(parseAmount('1500')).toBe(1_500_000_000n);
});

test('display: 2 decimals, or 6 below one unit; MAX round-trips exactly', () => {
  expect(fmt(1_493_266_819n)).toBe('1,493.26');
  expect(fmt(6_687n)).toBe('0.006687');
  expect(parseAmount(toInput(1_234_567_891n))).toBe(1_234_567_891n);
  expect(rate(1_500_000_000n, 10_000_000n)).toBe('150');
  expect(until(1_000, 5_000)).toBe('expired');
  expect(until(90 * 60_000, 0)).toBe('1h 30m');
});
