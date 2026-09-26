import { describe, expect, test } from 'bun:test';
import { buildQuotes, sharedLiquidityRatio } from '../src/quote';
import type { AllowanceState, StrategyState } from '../src/state';

const MAKER = '0xa';
const ALLOWANCE = '0xa11';
const NOW = 1_000_000;

const strategy = (over: Partial<StrategyState>): StrategyState => ({
  id: '0x1',
  maker: MAKER,
  makerAllowanceId: ALLOWANCE,
  kind: 'fixed',
  active: true,
  expiryMs: 9_000_000n,
  maxBasePerFill: 1_000_000_000_000n,
  virtualBaseRemaining: 1_000_000_000_000n,
  priceNum: 1n,
  priceDen: 150n,
  virtualBase: 0n,
  virtualQuote: 0n,
  feeBps: 0n,
  fillCount: 0n,
  baseFilled: 0n,
  quoteReceived: 0n,
  ...over,
});

const fixed = strategy({ id: '0xf' });
const curve = strategy({ id: '0xc', kind: 'curve', virtualBase: 1_000_000_000_000n, virtualQuote: 6_666_666_666n, feeBps: 30n });

const allowance = (over: Partial<AllowanceState> = {}): AllowanceState => ({
  id: ALLOWANCE,
  funder: MAKER,
  spender: '0xe',
  app: 'pkg::app::App',
  lifetimeCap: 1_000_000_000_000n,
  expirationMs: 9_000_000n,
  currentSpend: 0n,
  ...over,
});

const input = (over: Partial<Parameters<typeof buildQuotes>[0]> = {}) => ({
  strategies: [fixed, curve],
  allowances: new Map([[ALLOWANCE, allowance()]]),
  makerBalances: new Map([[MAKER, 1_000_000_000_000n]]),
  quoteIn: 10_000_000n,
  nowMs: NOW,
  ...over,
});

describe('buildQuotes', () => {
  test('quotes both strategies against one allowance, best first', () => {
    const quotes = buildQuotes(input());
    expect(quotes.map((q) => q.strategyId)).toEqual(['0xf', '0xc']);
    expect(quotes[0]!.baseOut).toBe(1_500_000_000n);
    expect(quotes[0]!.minBaseOut).toBe(1_485_000_000n); // 1% slippage
  });

  test('skips paused and expired strategies', () => {
    const quotes = buildQuotes(input({ strategies: [strategy({ id: '0xp', active: false }), strategy({ id: '0xx', expiryMs: 1n })] }));
    expect(quotes).toEqual([]);
  });

  test('caps by real balance, not advertised availability', () => {
    const quotes = buildQuotes(input({ makerBalances: new Map([[MAKER, 1_000n]]) }));
    expect(quotes).toEqual([]);
  });

  test('caps by allowance remaining', () => {
    const spent = allowance({ currentSpend: 1_000_000_000_000n - 1_000n });
    expect(buildQuotes(input({ allowances: new Map([[ALLOWANCE, spent]]) }))).toEqual([]);
  });

  test('revoked allowance means no quote', () => {
    expect(buildQuotes(input({ allowances: new Map() }))).toEqual([]);
  });
});

describe('sharedLiquidityRatio', () => {
  test('two strategies over one inventory = 2x', () => {
    expect(sharedLiquidityRatio([fixed, curve], 1_000_000_000_000n)).toBe(2);
  });
});
