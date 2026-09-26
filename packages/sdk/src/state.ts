import { curveBaseOut, fixedBaseOut } from './math';

// Parsers for GraphQL `contents.json`: u64/u256 arrive as strings, Option as value-or-null.
const big = (v: unknown) => BigInt(String(v ?? 0));
const optBig = (v: unknown) => (v === null || v === undefined ? null : BigInt(String(v)));

export type StrategyState = {
  id: string;
  maker: string;
  makerAllowanceId: string;
  kind: 'fixed' | 'curve';
  active: boolean;
  expiryMs: bigint;
  maxBasePerFill: bigint;
  virtualBaseRemaining: bigint;
  priceNum: bigint;
  priceDen: bigint;
  virtualBase: bigint;
  virtualQuote: bigint;
  feeBps: bigint;
  fillCount: bigint;
  baseFilled: bigint;
  quoteReceived: bigint;
};

export function parseStrategy(json: Record<string, unknown>): StrategyState {
  return {
    id: String(json.id),
    maker: String(json.maker),
    makerAllowanceId: String(json.maker_allowance_id),
    kind: Number(json.kind) === 0 ? 'fixed' : 'curve',
    active: Boolean(json.active),
    expiryMs: big(json.expiry_ms),
    maxBasePerFill: big(json.max_base_per_fill),
    virtualBaseRemaining: big(json.virtual_base_remaining),
    priceNum: big(json.price_num),
    priceDen: big(json.price_den),
    virtualBase: big(json.virtual_base),
    virtualQuote: big(json.virtual_quote),
    feeBps: big(json.fee_bps),
    fillCount: big(json.fill_count),
    baseFilled: big(json.base_filled),
    quoteReceived: big(json.quote_received),
  };
}

/** Same math as `strategy::quote` on chain. */
export function strategyBaseOut(s: StrategyState, quoteIn: bigint): bigint {
  return s.kind === 'fixed'
    ? fixedBaseOut(quoteIn, s.priceNum, s.priceDen)
    : curveBaseOut(quoteIn, s.virtualBase, s.virtualQuote, s.feeBps);
}

export type AllowanceState = {
  id: string;
  funder: string;
  spender: string | null;
  app: string | null;
  lifetimeCap: bigint | null;
  expirationMs: bigint | null;
  currentSpend: bigint;
};

export function parseAllowance(json: Record<string, unknown>): AllowanceState {
  const s = (json.settings ?? {}) as Record<string, unknown>;
  return {
    id: String(json.id),
    funder: String(s.funder),
    spender: s.spender === null || s.spender === undefined ? null : String(s.spender),
    app: s.app === null || s.app === undefined ? null : String(s.app),
    lifetimeCap: optBig(s.lifetime_cap),
    expirationMs: optBig(s.expiration_timestamp_ms),
    currentSpend: big(json.current_spend),
  };
}

/** What is left to spend under the lifetime cap (null cap = unlimited, bounded by rate limit only). */
export function allowanceRemaining(a: AllowanceState): bigint | null {
  return a.lifetimeCap === null ? null : a.lifetimeCap - a.currentSpend;
}

export type OrderState = {
  id: string;
  taker: string;
  recipient: string;
  strategyId: string;
  quoteIn: bigint;
  minBaseOut: bigint;
  quotedBaseOut: bigint;
  expiryMs: bigint;
  status: 'open' | 'filled' | 'cancelled';
};

export function parseOrder(json: Record<string, unknown>): OrderState {
  const status = Number(json.status);
  return {
    id: String(json.id),
    taker: String(json.taker),
    recipient: String(json.recipient),
    strategyId: String(json.strategy_id),
    quoteIn: big(json.quote_in),
    minBaseOut: big(json.min_base_out),
    quotedBaseOut: big(json.quoted_base_out),
    expiryMs: big(json.expiry_ms),
    status: status === 0 ? 'open' : status === 1 ? 'filled' : 'cancelled',
  };
}
