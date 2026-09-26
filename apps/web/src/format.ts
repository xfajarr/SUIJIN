import { formatUnits, parseUnits, type CoinKey } from '@suijin/sdk';

// Pure display and input helpers (no React), unit-tested in tests/format.test.ts.

/** 6-decimal amount for display: 2 decimals, or up to 6 below one whole unit. */
export const fmt = (v: bigint, maxFraction?: number) =>
  formatUnits(v, 6, maxFraction ?? (v !== 0n && v < 1_000_000n && v > -1_000_000n ? 6 : 2));
/** Amount with its symbol: "1,500 tJPY". */
export const fmtCoin = (v: bigint, coin: CoinKey) => `${fmt(v)} ${coin}`;
export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const pct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
/** How many `out` one unit of `in` buys, e.g. rate(1_500_000_000n, 10_000_000n) = "150". */
export const rate = (out: bigint, inp: bigint) =>
  inp === 0n ? '—' : (Number(out) / Number(inp)).toLocaleString('en-US', { maximumSignificantDigits: 6 });

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

/** Text field -> base units; null when empty or invalid. Accepts ".5". */
export function parseAmount(text: string): bigint | null {
  if (!/\d/.test(text)) return null;
  try {
    return parseUnits(text.startsWith('.') ? `0${text}` : text);
  } catch {
    return null;
  }
}
/** Base units -> editable text without grouping, e.g. for MAX. */
export const toInput = (v: bigint) => formatUnits(v, 6, 6).replace(/,/g, '');
/** Keeps what a user types to a decimal with at most 6 fraction digits. Commas are grouping. */
export function cleanAmount(text: string) {
  const t = text.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = t.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 6)}` : whole;
}
