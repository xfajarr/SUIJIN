import { strategyBaseOut, type AllowanceState, type FillParams, type OrderState, type StrategyState } from '@suijin/sdk';

export type PlanResult = { ok: true; params: FillParams } | { ok: false; error: string };

/**
 * Pre-flight for the executor. Move re-checks everything; this only avoids paying gas
 * for fills that would abort, and gives the UI a readable error.
 */
export function planFill(
  order: OrderState | null,
  strategy: StrategyState | null,
  takerAllowance: AllowanceState | null,
  takerAllowanceId: string,
  nowMs: number,
): PlanResult {
  if (!order) return { ok: false, error: 'ORDER_NOT_FOUND' };
  if (order.status === 'filled') return { ok: false, error: 'ORDER_ALREADY_FILLED' };
  if (order.status === 'cancelled') return { ok: false, error: 'ORDER_CANCELLED' };
  if (BigInt(nowMs) >= order.expiryMs) return { ok: false, error: 'ORDER_EXPIRED' };
  if (!strategy || strategy.id !== order.strategyId) return { ok: false, error: 'STRATEGY_NOT_FOUND' };
  if (!strategy.active) return { ok: false, error: 'STRATEGY_PAUSED' };
  if (!takerAllowance) return { ok: false, error: 'ALLOWANCE_REVOKED' };
  if (takerAllowance.funder !== order.taker || takerAllowance.lifetimeCap !== order.quoteIn) {
    return { ok: false, error: 'WRONG_TAKER_ALLOWANCE' };
  }
  const baseOut = strategyBaseOut(strategy, order.quoteIn);
  if (baseOut < order.minBaseOut) return { ok: false, error: 'SLIPPAGE_EXCEEDED' };
  return {
    ok: true,
    params: {
      strategyId: strategy.id,
      orderId: order.id,
      maker: strategy.maker,
      makerAllowanceId: strategy.makerAllowanceId,
      taker: order.taker,
      takerAllowanceId,
      baseOut,
      quoteIn: order.quoteIn,
    },
  };
}
