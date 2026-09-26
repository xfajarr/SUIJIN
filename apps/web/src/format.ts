import { PRICE_SCALE, formatUnits, parseUnits } from '@suijin/sdk';

// Pure display and input helpers (no React), unit-tested in tests/format.test.ts.

/** Token amount (raw units) for display: 2 decimals, or up to 6 significant places below one whole unit. */
export function amt(v: bigint, decimals: number, maxFraction?: number) {
  const one = 10n ** BigInt(decimals);
  return formatUnits(v, decimals, maxFraction ?? (v !== 0n && v < one && v > -one ? Math.min(decimals, 6) : 2));
}
/** Amount with its symbol: "1,500 tJPY". */
export const amtCoin = (v: bigint, symbol: string, decimals: number) => `${amt(v, decimals)} ${symbol}`;
/** A price (PRICE_SCALE fixed point, e.g. 150_410_000n = 150.41) for display. */
export const fmtPrice = (p: bigint, maxFraction?: number) => amt(p, 6, maxFraction);
export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const pct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
/** How many whole `out` one whole `in` buys, from raw amounts: rate(1_500_000_000n, 6, 10_000_000n, 6) = "150". */
export const rate = (out: bigint, outDecimals: number, inp: bigint, inDecimals: number) =>
  inp === 0n
    ? '—'
    : ((Number(out) / 10 ** outDecimals) / (Number(inp) / 10 ** inDecimals)).toLocaleString('en-US', { maximumSignificantDigits: 6 });

export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** "11h 58m" until `ms`, or "expired". */
export function until(ms: number | bigint, now = Date.now()) {
  const s = Math.round((Number(ms) - now) / 1000);
  if (s <= 0) return 'expired';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

/** Text field -> raw units; null when empty or invalid. Accepts ".5". */
export function parseAmount(text: string, decimals: number): bigint | null {
  if (!/\d/.test(text)) return null;
  try {
    return parseUnits(text.startsWith('.') ? `0${text}` : text, decimals);
  } catch {
    return null;
  }
}
/** Price text -> PRICE_SCALE fixed point. */
export const parsePrice = (text: string) => parseAmount(text, 6);
/** PRICE_SCALE fixed point -> editable text with 6 significant digits: "150.412", "3.21547", "0.0312345". */
export const priceText = (p: bigint) => {
  const x = Number(p) / 1e6;
  return x >= 1e-6 ? String(Number(x.toPrecision(6))) : toInput(p, 6);
};
/** Raw units -> editable text without grouping, e.g. for MAX. */
export const toInput = (v: bigint, decimals: number) => formatUnits(v, decimals, decimals).replace(/,/g, '');
/** Keeps what a user types to a decimal with at most `decimals` fraction digits. Commas are grouping. */
export function cleanAmount(text: string, decimals: number) {
  const t = text.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = t.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, decimals)}` : whole;
}
export { PRICE_SCALE };
