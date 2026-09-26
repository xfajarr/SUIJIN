import { describe, expect, test } from 'bun:test';
import type { AllowanceState, OrderState, StrategyState } from '@suijin/sdk';
import { planFill } from '../src/plan';

const NOW = 1_000;

const JPY = '0xc::tjpy::TJPY';
const USD = '0xc::tusd::TUSD';

const order: OrderState = {
  id: '0x0rd',
  baseType: JPY,
  quoteType: USD,
  taker: '0xb',
  recipient: '0xb',
  strategyId: '0xf',
  quoteIn: 10_000_000n,
  minBaseOut: 1_485_000_000n,
  quotedBaseOut: 1_500_000_000n,
  expiryMs: 60_000n,
  status: 'open',
};

const strategy: StrategyState = {
  id: '0xf',
  baseType: JPY,
  quoteType: USD,
  maker: '0xa',
  makerAllowanceId: '0xa11',
  kind: 'fixed',
  active: true,
  expiryMs: 9_000_000n,
  maxBasePerFill: 10n ** 12n,
  virtualBaseRemaining: 10n ** 12n,
  priceNum: 1n,
  priceDen: 150n,
  virtualBase: 0n,
  virtualQuote: 0n,
  feeBps: 0n,
  fillCount: 0n,
  baseFilled: 0n,
  quoteReceived: 0n,
};

const payment: AllowanceState = {
  id: '0xpay',
  funder: '0xb',
  spender: '0xe',
  app: 'pkg::app::App',
  lifetimeCap: 10_000_000n,
  expirationMs: 60_000n,
  currentSpend: 0n,
};

describe('planFill', () => {
  test('builds exact fill params', () => {
    const r = planFill(order, strategy, payment, '0xpay', NOW);
    expect(r).toEqual({
      ok: true,
      params: {
        strategyId: '0xf',
        orderId: '0x0rd',
        maker: '0xa',
        makerAllowanceId: '0xa11',
        taker: '0xb',
        takerAllowanceId: '0xpay',
        baseOut: 1_500_000_000n,
        quoteIn: 10_000_000n,
        pair: { base: JPY, quote: USD },
      },
    });
  });

  test('carries the strategy pair, so the reverse market settles with the right types', () => {
    const r = planFill(
      { ...order, baseType: USD, quoteType: JPY, quoteIn: 1_500_000_000n, minBaseOut: 1n },
      { ...strategy, baseType: USD, quoteType: JPY, priceNum: 150n, priceDen: 1n },
      { ...payment, lifetimeCap: 1_500_000_000n },
      '0xpay',
      NOW,
    );
    expect(r.ok && r.params.pair).toEqual({ base: USD, quote: JPY });
    expect(r.ok && r.params.baseOut).toBe(10_000_000n);
  });

  test('refuses replays', () => {
    expect(planFill({ ...order, status: 'filled' }, strategy, payment, '0xpay', NOW)).toEqual({ ok: false, error: 'ORDER_ALREADY_FILLED' });
  });

  test('refuses expired orders', () => {
    expect(planFill(order, strategy, payment, '0xpay', 60_000)).toEqual({ ok: false, error: 'ORDER_EXPIRED' });
  });

  test('refuses paused strategies', () => {
    expect(planFill(order, { ...strategy, active: false }, payment, '0xpay', NOW)).toEqual({ ok: false, error: 'STRATEGY_PAUSED' });
  });

  test('refuses a payment allowance from someone else', () => {
    expect(planFill(order, strategy, { ...payment, funder: '0xc' }, '0xpay', NOW)).toEqual({ ok: false, error: 'WRONG_TAKER_ALLOWANCE' });
  });

  test('refuses when the price moved past min out', () => {
    expect(planFill(order, { ...strategy, priceDen: 140n }, payment, '0xpay', NOW)).toEqual({ ok: false, error: 'SLIPPAGE_EXCEEDED' });
  });
});
