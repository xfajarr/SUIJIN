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
