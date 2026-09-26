import { describe, expect, test } from 'bun:test';
import { balanceKey, buildQuotes, sharedLiquidityRatio } from '../src/quote';
import type { AllowanceState, StrategyState } from '../src/state';

const MAKER = '0xa';
const ALLOWANCE = '0xa11';
const JPY = '0xc::tjpy::TJPY';
const USD = '0xc::tusd::TUSD';
const NOW = 1_000_000;

const strategy = (over: Partial<StrategyState>): StrategyState => ({
  id: '0x1',
  baseType: JPY,
  quoteType: USD,
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
  name: 'suijin liquidity budget',
  lifetimeCap: 1_000_000_000_000n,
  expirationMs: 9_000_000n,
  currentSpend: 0n,
  ...over,
});

const input = (over: Partial<Parameters<typeof buildQuotes>[0]> = {}) =>
  ({
    strategies: [fixed, curve],
    allowances: new Map([[ALLOWANCE, allowance()]]),
    makerBalances: new Map([[balanceKey(MAKER, JPY), 1_000_000_000_000n]]),
    quoteIn: 10_000_000n,
    nowMs: NOW,
    ...over,
  }) as Parameters<typeof buildQuotes>[0];

describe('buildQuotes', () => {
  test('quotes both strategies against one allowance, best first', () => {
    const quotes = buildQuotes(input());
    expect(quotes.map((q) => q.strategyId)).toEqual(['0xf', '0xc']);
    expect(quotes[0]!.baseOut).toBe(1_500_000_000n);
    expect(quotes[0]!.minBaseOut).toBe(1_485_000_000n); // 1% slippage
    expect(quotes[0]!.baseType).toBe(JPY);
  });

  test('skips paused and expired strategies', () => {
    const quotes = buildQuotes(input({ strategies: [strategy({ id: '0xp', active: false }), strategy({ id: '0xx', expiryMs: 1n })] }));
    expect(quotes).toEqual([]);
  });

  test('caps by real balance, not advertised availability', () => {
    const quotes = buildQuotes(input({ makerBalances: new Map([[balanceKey(MAKER, JPY), 1_000n]]) }));
    expect(quotes).toEqual([]);
  });

  test('caps by allowance remaining', () => {
    const spent = allowance({ currentSpend: 1_000_000_000_000n - 1_000n });
    expect(buildQuotes(input({ allowances: new Map([[ALLOWANCE, spent]]) }))).toEqual([]);
  });

  test('revoked allowance means no quote', () => {
    expect(buildQuotes(input({ allowances: new Map() }))).toEqual([]);
  });

  test('filters by direction: a tUSD-selling strategy never answers a tJPY request', () => {
    const reverse = strategy({ id: '0xr', baseType: USD, quoteType: JPY, priceNum: 150n, priceDen: 1n });
    const balances = new Map([
      [balanceKey(MAKER, JPY), 1_000_000_000_000n],
      [balanceKey(MAKER, USD), 1_000_000_000_000n],
    ]);
    const buyJpy = buildQuotes(input({ strategies: [fixed, reverse], makerBalances: balances, base: JPY, quote: USD }));
    expect(buyJpy.map((q) => q.strategyId)).toEqual(['0xf']);
    const buyUsd = buildQuotes(input({ strategies: [fixed, reverse], makerBalances: balances, base: USD, quote: JPY, quoteIn: 1_500_000_000n }));
    expect(buyUsd.map((q) => q.strategyId)).toEqual(['0xr']);
    expect(buyUsd[0]!.baseOut).toBe(10_000_000n);
  });

  test('exact output (Pay): cheapest input first, minimum is the exact target', () => {
    const quotes = buildQuotes(input({ quoteIn: undefined, baseOut: 1_500_000_000n, slippageBps: 0n }));
    expect(quotes.map((q) => q.strategyId)).toEqual(['0xf', '0xc']);
    expect(quotes[0]!.quoteIn).toBe(10_000_000n);
    for (const q of quotes) {
      expect(q.minBaseOut).toBe(1_500_000_000n);
      expect(q.baseOut >= 1_500_000_000n).toBe(true);
    }
  });

  test('exact output adds the slippage buffer to the input, so a moved curve still pays the target', () => {
    const [q] = buildQuotes(input({ strategies: [fixed], quoteIn: undefined, baseOut: 1_500_000_000n, slippageBps: 50n }));
    expect(q!.quoteIn).toBe(10_050_000n); // 10 tUSD + 0.5%
    expect(q!.minBaseOut).toBe(1_500_000_000n);
    expect(q!.baseOut).toBe(1_507_500_000n); // any extra goes to the recipient
  });

  test('price impact: zero for fixed, grows with size on the curve', () => {
    const small = buildQuotes(input({ strategies: [curve], quoteIn: 1_000_000n }))[0]!;
    const big = buildQuotes(input({ strategies: [curve], quoteIn: 1_000_000_000n }))[0]!;
    expect(buildQuotes(input({ strategies: [fixed] }))[0]!.impactBps).toBe(0);
    expect(big.impactBps).toBeGreaterThan(small.impactBps);
  });
});

describe('sharedLiquidityRatio', () => {
  test('two strategies over one inventory = 2x', () => {
    expect(sharedLiquidityRatio([fixed, curve], 1_000_000_000_000n)).toBe(2);
  });
});
