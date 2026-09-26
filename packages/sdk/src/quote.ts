import { normalizeType, sameType } from './config';
import { BPS } from './math';
import { allowanceRemaining, strategyBaseOut, strategyQuoteInFor, type AllowanceState, type StrategyState } from './state';

export type Quote = {
  strategyId: string;
  kind: 'fixed' | 'curve';
  maker: string;
  makerAllowanceId: string;
  /** What the trader receives (the provider sells it). */
  baseType: string;
  /** What the trader pays. */
  quoteType: string;
  quoteIn: bigint;
  baseOut: bigint;
  minBaseOut: bigint;
  expiresAtMs: number;
  /** Execution price vs the strategy's marginal price, in basis points. Always 0 for fixed rate. */
  impactBps: number;
};

/** Key for `makerBalances`: one provider's address balance of one coin. */
export const balanceKey = (maker: string, coinType: string) => `${maker}|${normalizeType(coinType)}`;

type Amount = { quoteIn: bigint; baseOut?: undefined } | { baseOut: bigint; quoteIn?: undefined };

export type QuoteInput = {
  strategies: StrategyState[];
  allowances: Map<string, AllowanceState>;
  /** balanceKey(maker, baseType) -> address balance */
  makerBalances: Map<string, bigint>;
  /** Only strategies that sell `base` for `quote`. Omit to accept any pair. */
  base?: string;
  quote?: string;
  nowMs: number;
  slippageBps?: bigint;
  ttlMs?: number;
} & Amount;

const cmp = (a: bigint, b: bigint) => (a > b ? 1 : a < b ? -1 : 0);

/**
 * Executable quotes. Exact input (`quoteIn`): most output first. Exact output (`baseOut`, used by
 * Pay): cheapest input first, and the minimum out is the target itself. A strategy is skipped when
 * paused, expired, on a revoked allowance, or when its output exceeds what can really settle:
 * min(address balance, allowance remaining, strategy remaining, max per fill).
 */
export function buildQuotes(input: QuoteInput): Quote[] {
  const { strategies, allowances, makerBalances, nowMs } = input;
  const slippageBps = input.slippageBps ?? 100n;
  const ttlMs = input.ttlMs ?? 60_000;
  const quotes: Quote[] = [];
  for (const s of strategies) {
    if (input.base && !sameType(s.baseType, input.base)) continue;
    if (input.quote && !sameType(s.quoteType, input.quote)) continue;
    if (!s.active || BigInt(nowMs) >= s.expiryMs) continue;
    const allowance = allowances.get(s.makerAllowanceId);
    if (!allowance || (allowance.expirationMs !== null && BigInt(nowMs) >= allowance.expirationMs)) continue;
    let quoteIn: bigint;
    let baseOut: bigint;
    try {
      if (input.quoteIn !== undefined) {
        quoteIn = input.quoteIn;
      } else {
        const needed = strategyQuoteInFor(s, input.baseOut);
        if (needed === null) continue;
        // Pay a little more than the exact price, so the target still arrives if the curve moves.
        // The order's quote_in is fixed; any extra output goes to the recipient.
        quoteIn = needed + (needed * slippageBps + 9_999n) / 10_000n;
      }
      baseOut = strategyBaseOut(s, quoteIn);
    } catch {
      continue;
    }
    const remaining = allowanceRemaining(allowance);
    const balance = makerBalances.get(balanceKey(s.maker, s.baseType)) ?? 0n;
    const executable = [balance, s.virtualBaseRemaining, s.maxBasePerFill, ...(remaining === null ? [] : [remaining])]
      .reduce((a, b) => (a < b ? a : b));
    if (baseOut <= 0n || baseOut > executable) continue;
    quotes.push({
      strategyId: s.id,
      kind: s.kind,
      maker: s.maker,
      makerAllowanceId: s.makerAllowanceId,
      baseType: s.baseType,
      quoteType: s.quoteType,
      quoteIn,
      baseOut,
      minBaseOut: input.baseOut !== undefined ? input.baseOut : (baseOut * (10_000n - slippageBps)) / 10_000n,
      expiresAtMs: nowMs + ttlMs,
      impactBps: impactBps(s, quoteIn, baseOut),
    });
  }
  return quotes.sort((a, b) => (input.quoteIn !== undefined ? cmp(b.baseOut, a.baseOut) : cmp(a.quoteIn, b.quoteIn)));
}

/** How much worse than the curve's marginal price (after fee) this trade executes. */
function impactBps(s: StrategyState, quoteIn: bigint, baseOut: bigint): number {
  if (s.kind === 'fixed' || s.virtualQuote === 0n) return 0;
  const ideal = (((quoteIn * (BPS - s.feeBps)) / BPS) * s.virtualBase) / s.virtualQuote;
  if (ideal <= 0n || baseOut >= ideal) return 0;
  return Number(((ideal - baseOut) * 10_000n) / ideal);
}

/** Shared Liquidity Ratio: advertised availability over real executable inventory. Display only. */
export function sharedLiquidityRatio(strategies: StrategyState[], executableInventory: bigint): number {
  if (executableInventory <= 0n) return 0;
  const advertised = strategies
    .filter((s) => s.active)
    .reduce((sum, s) => sum + (s.virtualBaseRemaining < executableInventory ? s.virtualBaseRemaining : executableInventory), 0n);
  return Number((advertised * 100n) / executableInventory) / 100;
}
