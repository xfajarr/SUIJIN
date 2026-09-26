import { expect, test } from 'bun:test';
import { amt, cleanAmount, parseAmount, priceText, rate, toInput, until } from '../src/format';

test('typing: digits and one dot, at most `decimals` places, commas are grouping', () => {
  expect(cleanAmount('1,500.25', 6)).toBe('1500.25');
  expect(cleanAmount('1.2.3', 6)).toBe('1.23');
  expect(cleanAmount('0.1234567', 6)).toBe('0.123456');
  expect(cleanAmount('0.1234567891', 9)).toBe('0.123456789');
  expect(cleanAmount('abc12', 6)).toBe('12');
});

test('parse: empty or invalid is null, ".5" works, decimals per token', () => {
  expect(parseAmount('', 6)).toBeNull();
  expect(parseAmount('.', 6)).toBeNull();
  expect(parseAmount('.5', 6)).toBe(500_000n);
  expect(parseAmount('10.', 6)).toBe(10_000_000n);
  expect(parseAmount('1500', 6)).toBe(1_500_000_000n);
  expect(parseAmount('1.5', 9)).toBe(1_500_000_000n); // SUI
});

test('display: 2 decimals, or up to 6 below one unit; MAX round-trips exactly', () => {
  expect(amt(1_493_266_819n, 6)).toBe('1,493.26');
  expect(amt(6_687n, 6)).toBe('0.006687');
  expect(amt(2_500_000_000n, 9)).toBe('2.5');
  expect(amt(1_234_567n, 9)).toBe('0.001234');
  expect(parseAmount(toInput(1_234_567_891n, 6), 6)).toBe(1_234_567_891n);
  expect(parseAmount(toInput(1_234_567_891n, 9), 9)).toBe(1_234_567_891n);
  expect(rate(1_500_000_000n, 6, 10_000_000n, 6)).toBe('150');
  expect(rate(3_200_000n, 6, 1_000_000_000n, 9)).toBe('3.2'); // 1 SUI = 3.2 USDC
  expect(until(1_000, 5_000)).toBe('expired');
  expect(until(90 * 60_000, 0)).toBe('1h 30m');
});

test('price text: 6 significant digits that parse back', () => {
  expect(priceText(150_411_950n)).toBe('150.412');
  expect(priceText(3_215_470n)).toBe('3.21547');
  expect(priceText(31_234n)).toBe('0.031234');
  expect(priceText(150_000_000n)).toBe('150');
});
