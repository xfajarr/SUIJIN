import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildFill, getAllowance, getOrder, getStrategy } from '@suijin/sdk';
import { planFill } from './plan';

export type FillOutcome = { ok: true; digest: string } | { ok: false; error: string };

// ponytail: in-memory idempotency, one process. Move's order status is the real replay guard.
const inflight = new Map<string, Promise<FillOutcome>>();

export function fillOrder(client: SuiGrpcClient, signer: Ed25519Keypair, orderId: string, takerAllowanceId: string): Promise<FillOutcome> {
  const running = inflight.get(orderId);
  if (running) return running;
  const job = settle(client, signer, orderId, takerAllowanceId);
  inflight.set(orderId, job);
  job.then((r) => {
    if (!r.ok) inflight.delete(orderId); // failures may be retried
  });
  return job;
}

async function settle(client: SuiGrpcClient, signer: Ed25519Keypair, orderId: string, takerAllowanceId: string): Promise<FillOutcome> {
  const order = await getOrder(orderId);
  const [strategy, payment] = await Promise.all([
    order ? getStrategy(order.strategyId) : null,
    getAllowance(takerAllowanceId),
  ]);
  const plan = planFill(order, strategy, payment, takerAllowanceId, Date.now());
  if (!plan.ok) return plan;
  try {
    const result = await client.signAndExecuteTransaction({
      transaction: buildFill(plan.params),
      signer,
      include: { effects: true },
    });
    if (result.$kind === 'FailedTransaction') {
      return { ok: false, error: result.FailedTransaction.status.error?.message ?? 'FILL_FAILED' };
    }
    await client.waitForTransaction({ result });
    console.log(`filled ${orderId} -> ${result.Transaction.digest}`);
    return { ok: true, digest: result.Transaction.digest };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
