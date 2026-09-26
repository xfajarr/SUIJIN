import { useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import type { Transaction } from '@mysten/sui/transactions';
import { DEPLOYMENT, type Quote } from '@suijin/sdk';
import { useCallback, useEffect, useState } from 'react';

export const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8790';
export const explorerTx = (digest: string) => `https://suiscan.xyz/${DEPLOYMENT.network}/tx/${digest}`;

/** Sign with the wallet, wait for effects, and return helpers to find created objects by type. */
export function useRun() {
  const dAppKit = useDAppKit();
  const client = useCurrentClient();
  return useCallback(
    async (tx: Transaction) => {
      const signed = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (signed.FailedTransaction) throw new Error(signed.FailedTransaction.status.error?.message ?? 'transaction failed');
      const done = await client.waitForTransaction({ digest: signed.Transaction.digest, include: { effects: true, objectTypes: true } });
      if (done.$kind === 'FailedTransaction') throw new Error(done.FailedTransaction.status.error?.message ?? 'transaction failed');
      const { effects, objectTypes } = done.Transaction;
      const created = (fragment: string) =>
        effects.changedObjects.find((c) => c.idOperation === 'Created' && objectTypes[c.objectId]?.includes(fragment))?.objectId ?? '';
      return { digest: done.Transaction.digest, created };
    },
    [dAppKit, client],
  );
}

/** Re-runs `read` every `ms` and whenever `deps` change. `refresh` forces a reload. */
export function usePoll<T>(read: () => Promise<T>, deps: unknown[], ms = 4000) {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => read().then((v) => live && setValue(v)).catch((e) => console.error(e));
    load();
    const id = setInterval(load, ms);
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { value, refresh: () => setTick((t) => t + 1) };
}

const reviveQuote = (q: Record<string, string | number>): Quote => ({
  strategyId: String(q.strategyId),
  kind: q.kind === 'fixed' ? 'fixed' : 'curve',
  maker: String(q.maker),
  makerAllowanceId: String(q.makerAllowanceId),
  quoteIn: BigInt(q.quoteIn!),
  baseOut: BigInt(q.baseOut!),
  minBaseOut: BigInt(q.minBaseOut!),
  expiresAtMs: Number(q.expiresAtMs),
});

export async function fetchQuotes(quoteIn: bigint): Promise<Quote[]> {
  const res = await fetch(`${SERVER}/v1/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteIn: quoteIn.toString() }),
  });
  if (!res.ok) throw new Error(`quote failed: ${res.status}`);
  return ((await res.json()) as Record<string, string | number>[]).map(reviveQuote);
}

export async function requestFill(orderId: string, takerAllowanceId: string): Promise<{ ok: boolean; digest?: string; error?: string }> {
  const res = await fetch(`${SERVER}/v1/orders/${orderId}/fill`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ takerAllowanceId }),
  });
  return res.json();
}
