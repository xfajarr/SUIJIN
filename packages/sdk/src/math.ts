// Mirrors contracts/suijin/sources/math.move exactly. Keep the two in sync.
export const BPS = 10_000n;

/** `priceNum` quote units buy `priceDen` base units. Rounds down. */
export function fixedBaseOut(quoteIn: bigint, priceNum: bigint, priceDen: bigint): bigint {
  if (priceNum <= 0n || priceDen <= 0n) throw new Error('price must be positive');
  return (quoteIn * priceDen) / priceNum;
}

/** Constant product on virtual reserves; new base reserve rounds up (maker-favoured). */
export function curveBaseOut(quoteIn: bigint, virtualBase: bigint, virtualQuote: bigint, feeBps: bigint): bigint {
  if (virtualBase <= 0n || virtualQuote <= 0n) throw new Error('reserves must be positive');
  if (feeBps >= BPS) throw new Error('fee too high');
  const effectiveIn = (quoteIn * (BPS - feeBps)) / BPS;
  const k = virtualBase * virtualQuote;
  const newQuote = virtualQuote + effectiveIn;
  const newBase = (k + newQuote - 1n) / newQuote;
  return virtualBase - newBase;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Smallest quote_in whose fixed-rate output reaches `baseOut` (exact-output quotes). */
export function fixedQuoteInFor(baseOut: bigint, priceNum: bigint, priceDen: bigint): bigint {
  if (priceNum <= 0n || priceDen <= 0n) throw new Error('price must be positive');
  return ceilDiv(baseOut * priceNum, priceDen);
}

/** Smallest quote_in whose curve output reaches `baseOut`; null when the curve cannot pay that much. */
export function curveQuoteInFor(baseOut: bigint, virtualBase: bigint, virtualQuote: bigint, feeBps: bigint): bigint | null {
  if (baseOut <= 0n) return 0n;
  if (baseOut >= virtualBase) return null;
  // ceil(k / (vq + eff)) <= vb - out  <=>  eff >= ceil(k / (vb - out)) - vq
  const neededEffective = ceilDiv(virtualBase * virtualQuote, virtualBase - baseOut) - virtualQuote;
  const quoteIn = ceilDiv(neededEffective * BPS, BPS - feeBps);
  return curveBaseOut(quoteIn, virtualBase, virtualQuote, feeBps) >= baseOut ? quoteIn : quoteIn + 1n;
}

/** "1,500.25" style display for 6-decimal amounts. */
export function formatUnits(value: bigint, decimals = 6, maxFraction = 2): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = (v / scale).toLocaleString('en-US');
  const frac = (v % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** "10.5" -> 10_500_000n for 6 decimals. */
export function parseUnits(text: string, decimals = 6): bigint {
  const parts = text.trim().split('.');
  const [whole = '0', frac = ''] = parts;
  if (parts.length > 2 || !/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > decimals) {
    throw new Error(`invalid amount: ${text}`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0'));
}

// ---------- prices across decimals ----------
// Prices are human rates, "1 unit = P priced", held as integers with PRICE_SCALE fraction digits
// (150.41 -> 150_410_000n). Tokens differ in decimals (SUI 9, USDC 6), so every conversion to
// on-chain raw units goes through these helpers.

export const PRICE_SCALE = 1_000_000n;
const pow10 = (n: number) => 10n ** BigInt(n);
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
/** Smallest integers with the same ratio, so prices stay far from u64 max. */
const reduce = (num: bigint, den: bigint) => {
  const g = gcd(num, den);
  return { priceNum: num / g, priceDen: den / g };
};

export type PairDecimals = { unitDecimals: number; pricedDecimals: number };
/** Which coin the strategy sells: the priced coin (base = priced) or the unit coin (base = unit). */
export type SellSide = 'priced' | 'unit';

/**
 * Fixed-price strategy terms with the fee as a spread in the provider's favour:
 * selling priced, 1 unit buys P·(1 − fee) priced; selling unit, P·(1 + fee) priced buys 1 unit.
 */
export function fixedPriceFor(p: PairDecimals & { sell: SellSide; price: bigint; feeBps: bigint }) {
  if (p.price <= 0n) throw new Error('price must be positive');
  const unitRaw = pow10(p.unitDecimals);
  const pricedRaw = pow10(p.pricedDecimals);
  return p.sell === 'priced'
    ? reduce(unitRaw * PRICE_SCALE * BPS, p.price * pricedRaw * (BPS - p.feeBps)) // quote = unit, base = priced
    : reduce(p.price * pricedRaw * (BPS + p.feeBps), PRICE_SCALE * unitRaw * BPS); // quote = priced, base = unit
}

/** Curve reserves that start at price P: virtual base = budget × depth, virtual quote at P. */
export function curveReservesFor(p: PairDecimals & { sell: SellSide; price: bigint; amount: bigint; depth: bigint }) {
  if (p.price <= 0n) throw new Error('price must be positive');
  const virtualBase = p.amount * p.depth;
  const unitRaw = pow10(p.unitDecimals);
  const pricedRaw = pow10(p.pricedDecimals);
  const virtualQuote =
    p.sell === 'priced'
      ? (virtualBase * unitRaw * PRICE_SCALE) / (p.price * pricedRaw) // base priced, quote unit
      : (virtualBase * p.price * pricedRaw) / (PRICE_SCALE * unitRaw); // base unit, quote priced
  return { virtualBase, virtualQuote };
}

/** Human price (PRICE_SCALE) from a trade: `unitAmount` of unit against `pricedAmount` of priced, both raw. */
export function priceOf(p: PairDecimals & { unitAmount: bigint; pricedAmount: bigint }): bigint | null {
  if (p.unitAmount <= 0n) return null;
  return (p.pricedAmount * pow10(p.unitDecimals) * PRICE_SCALE) / (p.unitAmount * pow10(p.pricedDecimals));
}

/** Raw amount of the other side at price P: unit -> priced or priced -> unit. Rounds down. */
export function convertAt(p: PairDecimals & { price: bigint; amount: bigint; from: SellSide }): bigint {
  if (p.price <= 0n) return 0n;
  const unitRaw = pow10(p.unitDecimals);
  const pricedRaw = pow10(p.pricedDecimals);
  return p.from === 'unit' ? (p.amount * p.price * pricedRaw) / (PRICE_SCALE * unitRaw) : (p.amount * PRICE_SCALE * unitRaw) / (p.price * pricedRaw);
}
