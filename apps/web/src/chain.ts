import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import type { Transaction } from '@mysten/sui/transactions';
import {
  DEPLOYMENT,
  addressBalance,
  allowanceRemaining,
  coinsOf,
  freshAllowances,
  freshStrategies,
  listAllowanceCaps,
  listStrategies,
  type AllowanceState,
  type CoinKey,
  type Quote,
  type StrategyState,
} from '@suijin/sdk';
import { useCallback, useEffect, useState } from 'react';

// Data layer for every page: server API, chain reads, wallet transactions, toasts.

export const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:8790';
export const COINS = coinsOf();
export const COIN_KEYS: CoinKey[] = ['tUSD', 'tJPY'];
export const other = (c: CoinKey): CoinKey => (c === 'tUSD' ? 'tJPY' : 'tUSD');
/** 'tJPY' for a strategy's coin type (the demo only has two coins). */
export const keyOf = (type: string): CoinKey => (type.toLowerCase().endsWith('::tjpy::tjpy') ? 'tJPY' : 'tUSD');

const scan = `https://suiscan.xyz/${DEPLOYMENT.network}`;
export const explorer = {
  tx: (digest: string) => `${scan}/tx/${digest}`,
  object: (id: string) => `${scan}/object/${id}`,
  account: (address: string) => `${scan}/account/${address}`,
};

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Turns wallet, server and Move errors into one sentence a trader can act on. */
export function friendlyError(e: unknown): string {
  const m = message(e);
  if (/reject|denied|cancel+ed by|user abort/i.test(m)) return 'Request rejected in your wallet.';
  if (/unreachable/i.test(m)) return m;
  if (/SLIPPAGE/i.test(m)) return 'The price moved past your slippage limit. Get a fresh quote and try again.';
  if (/ORDER_EXPIRED/.test(m)) return 'The order expired before it settled.';
  if (/ORDER_NOT_FOUND/.test(m)) return 'The executor cannot see the order yet. Retry in a few seconds.';
  if (/STRATEGY_PAUSED/.test(m)) return 'The provider just paused this market.';
  if (/ALLOWANCE_REVOKED/.test(m)) return 'The approval was revoked.';
  if (/insufficient/i.test(m)) return 'Not enough balance (or SUI for gas) to complete this.';
  return m.length > 160 ? `${m.slice(0, 160)}…` : m;
}

// ---------- toasts: a tiny global store, rendered by <Toasts /> ----------

export type Toast = { id: number; kind: 'pending' | 'success' | 'error'; title: string; body?: string; href?: string; leaving?: boolean };
let toastList: Toast[] = [];
let toastSeq = 0;
const toastSubs = new Set<() => void>();
const setToasts = (next: Toast[]) => {
  toastList = next;
  toastSubs.forEach((f) => f());
};
const autoClose = (id: number) => setTimeout(() => toast.dismiss(id), 6000);
export const toast = {
  subscribe: (f: () => void) => {
    toastSubs.add(f);
    return () => void toastSubs.delete(f);
  },
  list: () => toastList,
  push(t: Omit<Toast, 'id'>) {
    const id = ++toastSeq;
    setToasts([...toastList, { ...t, id }].slice(-4));
    if (t.kind !== 'pending') autoClose(id);
    return id;
  },
  update(id: number, t: Partial<Omit<Toast, 'id'>>) {
    setToasts(toastList.map((x) => (x.id === id ? { ...x, ...t } : x)));
    if (t.kind && t.kind !== 'pending') autoClose(id);
  },
  dismiss(id: number) {
    setToasts(toastList.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts(toastList.filter((x) => x.id !== id)), 250);
  },
};

// ---------- polling ----------

const REFRESH = 'suijin:refresh';
/** Every usePoll reloads now. useRun calls it after each landed transaction. */
export const refreshAll = () => window.dispatchEvent(new Event(REFRESH));

export type Poll<T> = { value: T | null; error: string | null; refresh: () => void };

/** Loads now, every `ms`, when `deps` change (value resets to null = skeleton) and on refreshAll(). */
export function usePoll<T>(read: () => Promise<T>, deps: unknown[], ms = 5000): Poll<T> {
  const [state, setState] = useState<{ value: T | null; error: string | null }>({ value: null, error: null });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setState({ value: null, error: null }), deps);
  useEffect(() => {
    let live = true;
    const load = () =>
      read().then(
        (value) => live && setState({ value, error: null }),
        (e) => live && setState((s) => ({ value: s.value, error: message(e) })),
      );
    load();
    const id = setInterval(load, ms);
    window.addEventListener(REFRESH, load);
    return () => {
      live = false;
      clearInterval(id);
      window.removeEventListener(REFRESH, load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, refresh };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---------- chain reads ----------

export type Balances = Record<CoinKey, bigint> & { sui: bigint };

/** The connected wallet's address balances (what allowances can spend) plus SUI for gas. null = no wallet. */
export function useBalances(): Poll<Balances | null> {
  const me = useCurrentAccount()?.address;
  const client = useCurrentClient();
  return usePoll(async () => {
    if (!me) return null;
    const [tUSD, tJPY, sui] = await Promise.all([
      addressBalance(client, me, COINS.tUSD.type),
      addressBalance(client, me, COINS.tJPY.type),
      client.getBalance({ owner: me, coinType: '0x2::sui::SUI' }),
    ]);
    return { tUSD, tJPY, sui: BigInt(sui.balance.balance) };
  }, [me, client]);
}

export type Budget = {
  coin: CoinKey;
  capId: string;
  allowance: AllowanceState;
  /** Left under the lifetime cap; null = uncapped. */
  remaining: bigint | null;
  /** This wallet's strategies that sell from this budget. */
  markets: StrategyState[];
};
export type Approval = { coin: CoinKey; capId: string; allowance: AllowanceState };
export type Positions = {
  /** Liquidity budgets: allowances this wallet granted to back its markets. */
  budgets: Budget[];
  /** Trader payment approvals that are still unspent (a failed or abandoned order). */
  approvals: Approval[];
  /** Every strategy this wallet created, fresh from the fullnode. */
  strategies: StrategyState[];
};

/** Everything the connected wallet provides. null = no wallet. */
export function usePositions(): Poll<Positions | null> {
  const me = useCurrentAccount()?.address;
  const client = useCurrentClient();
  return usePoll(
    async () => {
      if (!me) return null;
      const [caps, listed] = await Promise.all([
        Promise.all(COIN_KEYS.map(async (coin) => (await listAllowanceCaps(me, COINS[coin].type)).map((c) => ({ ...c, coin })))).then((x) => x.flat()),
        listStrategies(),
      ]);
      const mine = listed.filter((s) => s.maker.toLowerCase() === me.toLowerCase());
      const [strategies, allowances] = await Promise.all([
        freshStrategies(client, mine.map((s) => s.id)),
        freshAllowances(client, caps.map((c) => c.allowanceId)),
      ]);
      const live = caps.flatMap((c) => {
        const allowance = allowances.get(c.allowanceId);
        return allowance ? [{ ...c, allowance }] : []; // missing = revoked
      });
      const isPayment = (a: AllowanceState) => a.name === 'suijin order payment';
      const now = BigInt(Date.now());
      return {
        budgets: live
          .filter((c) => !isPayment(c.allowance))
          .map((c) => ({ ...c, remaining: allowanceRemaining(c.allowance), markets: strategies.filter((s) => s.makerAllowanceId === c.allowanceId) })),
        approvals: live.filter(
          (c) => isPayment(c.allowance) && c.allowance.currentSpend < (c.allowance.lifetimeCap ?? 0n) && (c.allowance.expirationMs ?? 0n) > now,
        ),
        strategies,
      };
    },
    [me, client],
    8000,
  );
}

// ---------- executor API ----------

export type QuoteRequest = { sell: CoinKey; buy: CoinKey; slippageBps: number } & ({ amountIn: bigint } | { amountOut: bigint });

const stringify = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

async function call(path: string, body?: unknown): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await fetch(`${SERVER}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: stringify(body) });
  } catch {
    throw new Error(`Executor unreachable at ${SERVER}`);
  }
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const reviveQuote = (q: Record<string, unknown>): Quote => ({
  strategyId: String(q.strategyId),
  kind: q.kind === 'fixed' ? 'fixed' : 'curve',
  maker: String(q.maker),
  makerAllowanceId: String(q.makerAllowanceId),
  baseType: String(q.baseType),
  quoteType: String(q.quoteType),
  quoteIn: BigInt(String(q.quoteIn)),
  baseOut: BigInt(String(q.baseOut)),
  minBaseOut: BigInt(String(q.minBaseOut)),
  expiresAtMs: Number(q.expiresAtMs),
  impactBps: Number(q.impactBps ?? 0),
  feeBps: Number(q.feeBps ?? 0),
});

/** Quote API this app needs. Servers from before two-way quotes report no version. */
const API = 2;
const OUTDATED = 'The executor server is out of date. Restart it: bun run server';

/** Best first: most output (exact in) or cheapest input (exact out). */
export async function fetchQuotes(req: QuoteRequest): Promise<Quote[]> {
  const { status, data } = await call('/v1/quote', req);
  if (status !== 200) throw new Error(/quoteIn must be/.test(String(data.error)) ? OUTDATED : (data.error ?? `Quote failed (${status})`));
  return (data as Record<string, unknown>[]).map(reviveQuote);
}

export async function requestFill(orderId: string, takerAllowanceId: string): Promise<{ ok: true; digest: string } | { ok: false; error: string }> {
  const { data } = await call(`/v1/orders/${orderId}/fill`, { takerAllowanceId });
  return data.ok ? { ok: true, digest: String(data.digest) } : { ok: false, error: String(data.error ?? 'FILL_FAILED') };
}

export async function fetchHealth(): Promise<{ ok: boolean; executor: string; outdated: boolean }> {
  const { data } = await call('/v1/health');
  return { ok: data.ok === true, executor: String(data.executor ?? ''), outdated: Number(data.api ?? 1) < API };
}

export type LiveQuotes = { quotes: Quote[]; best: Quote | null; loading: boolean; error: string | null; updatedAt: number; refresh: () => void };

/**
 * Live quotes for `req` (null = nothing to quote). Debounced while typing, refreshed every
 * `refreshMs`; answers for an older input are dropped. `loading` only on a new input, not on refresh.
 */
export function useQuotes(req: QuoteRequest | null, refreshMs = 15_000): LiveQuotes {
  const key = req ? stringify(req) : '';
  const debounced = useDebounced(key, 350);
  const [res, setRes] = useState({ key: '', quotes: [] as Quote[], error: null as string | null, at: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!debounced) return;
    let live = true;
    const load = () =>
      fetchQuotes(JSON.parse(debounced)).then(
        (quotes) => live && setRes({ key: debounced, quotes, error: null, at: Date.now() }),
        (e) => live && setRes({ key: debounced, quotes: [], error: message(e), at: Date.now() }),
      );
    load();
    const id = setInterval(load, refreshMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [debounced, tick, refreshMs]);
  const current = key !== '' && res.key === key;
  return {
    quotes: current ? res.quotes : [],
    best: current ? (res.quotes[0] ?? null) : null,
    loading: key !== '' && !current,
    error: current ? res.error : null,
    updatedAt: current ? res.at : 0,
    refresh: useCallback(() => setTick((t) => t + 1), []),
  };
}

// ---------- wallet transactions ----------

export type RunResult = { digest: string; created: (...typeFragments: string[]) => string };

/**
 * Signs with the wallet, waits for effects, then refreshes every poll.
 * `created('::order::SwapOrder<')` returns the id of a new object whose type contains every fragment.
 */
export function useRun() {
  const dAppKit = useDAppKit();
  const client = useCurrentClient();
  return useCallback(
    async (tx: Transaction): Promise<RunResult> => {
      const signed = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (signed.FailedTransaction) throw new Error(signed.FailedTransaction.status.error?.message ?? 'Transaction failed');
      const done = await client.waitForTransaction({ digest: signed.Transaction.digest, include: { effects: true, objectTypes: true } });
      if (done.$kind === 'FailedTransaction') throw new Error(done.FailedTransaction.status.error?.message ?? 'Transaction failed');
      const { effects, objectTypes } = done.Transaction;
      refreshAll();
      return {
        digest: done.Transaction.digest,
        created: (...fragments) =>
          effects.changedObjects.find((c) => c.idOperation === 'Created' && fragments.every((f) => objectTypes[c.objectId]?.includes(f)))?.objectId ?? '',
      };
    },
    [dAppKit, client],
  );
}

/**
 * One-click actions with a pending -> success/error toast. `busy` is the running action's key,
 * so a list can spin only the row that was clicked. Resolves to null on failure.
 */
export function useAction() {
  const run = useRun();
  const [busy, setBusy] = useState<string | null>(null);
  const act = useCallback(
    async (label: string, build: () => Transaction, opts: { done?: string; key?: string } = {}) => {
      setBusy(opts.key ?? label);
      const id = toast.push({ kind: 'pending', title: `${label}…`, body: 'Confirm in your wallet' });
      try {
        const r = await run(build());
        toast.update(id, { kind: 'success', title: opts.done ?? label, body: undefined, href: explorer.tx(r.digest) });
        return r;
      } catch (e) {
        toast.update(id, { kind: 'error', title: `${label} failed`, body: friendlyError(e) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [run],
  );
  return { act, busy };
}

/** Opens the wallet picker from anywhere (the modal is mounted once in App). */
export const connectModal: { current: { show: () => void } | null } = { current: null };
export const openConnect = () => connectModal.current?.show();
