import { defaultPair } from './config';
import { curveBaseOut, curveQuoteInFor, fixedBaseOut, fixedQuoteInFor } from './math';

// Parsers for GraphQL `contents.json`: u64/u256 arrive as strings, Option as value-or-null.
const big = (v: unknown) => BigInt(String(v ?? 0));
const optBig = (v: unknown) => (v === null || v === undefined ? null : BigInt(String(v)));

/** `0x…::strategy::Strategy<A,B>` -> ['A', 'B']: top-level generic arguments only. */
export function typeArgs(repr: string): string[] {
  const start = repr.indexOf('<');
  if (start < 0 || !repr.endsWith('>')) return [];
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of repr.slice(start + 1, -1)) {
    if (ch === '<') depth++;
    if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** Base/quote from an object's type; the default market when the type is unknown. */
function pairOf(repr?: string) {
  const [base, quote] = repr ? typeArgs(repr) : [];
  return base && quote ? { baseType: base, quoteType: quote } : { baseType: defaultPair().base, quoteType: defaultPair().quote };
}

export type StrategyState = {
  id: string;
  /** What the provider sells. */
  baseType: string;
  /** What the provider receives. */
  quoteType: string;
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

export function parseStrategy(json: Record<string, unknown>, typeRepr?: string): StrategyState {
  return {
    id: String(json.id),
    ...pairOf(typeRepr),
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

/** Smallest input that makes this strategy pay out at least `baseOut`; null if it cannot. */
export function strategyQuoteInFor(s: StrategyState, baseOut: bigint): bigint | null {
  return s.kind === 'fixed'
    ? fixedQuoteInFor(baseOut, s.priceNum, s.priceDen)
    : curveQuoteInFor(baseOut, s.virtualBase, s.virtualQuote, s.feeBps);
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
  baseType: string;
  quoteType: string;
  taker: string;
  recipient: string;
  strategyId: string;
  quoteIn: bigint;
  minBaseOut: bigint;
  quotedBaseOut: bigint;
  expiryMs: bigint;
  status: 'open' | 'filled' | 'cancelled';
};

export function parseOrder(json: Record<string, unknown>, typeRepr?: string): OrderState {
  const status = Number(json.status);
  return {
    id: String(json.id),
    ...pairOf(typeRepr),
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
