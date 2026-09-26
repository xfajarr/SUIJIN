import { allowanceRemaining, strategyBaseOut, type AllowanceState, type StrategyState } from './state';

export type Quote = {
  strategyId: string;
  kind: 'fixed' | 'curve';
  maker: string;
  makerAllowanceId: string;
  quoteIn: bigint;
  baseOut: bigint;
  minBaseOut: bigint;
  expiresAtMs: number;
};

export type QuoteInput = {
  strategies: StrategyState[];
  allowances: Map<string, AllowanceState>;
  /** maker address -> base-coin address balance */
  makerBalances: Map<string, bigint>;
  quoteIn: bigint;
  nowMs: number;
  slippageBps?: bigint;
  ttlMs?: number;
};

/**
 * Executable quotes, best first. A strategy is skipped when paused, expired, or when its
 * output exceeds what can really settle: min(address balance, allowance remaining,
 * strategy remaining, max per fill).
 */
export function buildQuotes(input: QuoteInput): Quote[] {
  const { strategies, allowances, makerBalances, quoteIn, nowMs } = input;
  const slippageBps = input.slippageBps ?? 100n;
  const ttlMs = input.ttlMs ?? 60_000;
  const quotes: Quote[] = [];
  for (const s of strategies) {
    if (!s.active || BigInt(nowMs) >= s.expiryMs) continue;
    const allowance = allowances.get(s.makerAllowanceId);
    if (!allowance || (allowance.expirationMs !== null && BigInt(nowMs) >= allowance.expirationMs)) continue;
    let baseOut: bigint;
    try {
      baseOut = strategyBaseOut(s, quoteIn);
    } catch {
      continue;
    }
    const remaining = allowanceRemaining(allowance);
    const balance = makerBalances.get(s.maker) ?? 0n;
    const executable = [balance, s.virtualBaseRemaining, s.maxBasePerFill, ...(remaining === null ? [] : [remaining])]
      .reduce((a, b) => (a < b ? a : b));
    if (baseOut <= 0n || baseOut > executable) continue;
    quotes.push({
      strategyId: s.id,
      kind: s.kind,
      maker: s.maker,
      makerAllowanceId: s.makerAllowanceId,
      quoteIn,
      baseOut,
      minBaseOut: (baseOut * (10_000n - slippageBps)) / 10_000n,
      expiresAtMs: nowMs + ttlMs,
    });
  }
  return quotes.sort((a, b) => (b.baseOut > a.baseOut ? 1 : b.baseOut < a.baseOut ? -1 : 0));
}

/** Shared Liquidity Ratio: advertised availability over real executable inventory. Display only. */
export function sharedLiquidityRatio(strategies: StrategyState[], executableInventory: bigint): number {
  if (executableInventory <= 0n) return 0;
  const advertised = strategies
    .filter((s) => s.active)
    .reduce((sum, s) => sum + (s.virtualBaseRemaining < executableInventory ? s.virtualBaseRemaining : executableInventory), 0n);
  return Number((advertised * 100n) / executableInventory) / 100;
}
