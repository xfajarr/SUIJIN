import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import type { Transaction } from '@mysten/sui/transactions';
import {
  DEPLOYMENT,
  allowanceRemaining,
  normalizeType,
  sameType,
  tokensOf,
  freshAllowances,
  freshStrategies,
  listAllowanceCaps,
  listStrategies,
  type AllowanceState,
  type CoinInfo,
  type CoinKey,
  type Quote,
  type StrategyState,
} from '@suijin/sdk';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// Data layer for every page: server API, chain reads, wallet transactions, toasts.

export const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:8790';

// ---------- tokens: the SDK registry plus coins this browser added by type ----------

const CUSTOM = 'suijin:tokens';
const readCustom = (): CoinInfo[] => {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM) ?? '[]') as CoinInfo[];
  } catch {
    return [];
  }
};
let tokenList: CoinInfo[] = [...tokensOf(), ...readCustom()];
const tokenSubs = new Set<() => void>();

/** Every token the app can pick. Custom ones are per browser; the chain accepts any coin type. */
export const tokens = () => tokenList;
export const useTokens = () =>
  useSyncExternalStore(
    (f) => {
      tokenSubs.add(f);
      return () => void tokenSubs.delete(f);
    },
    tokens,
    tokens,
  );

/** Adds a coin found by type (from fetchCoinInfo). A symbol clash keeps both, suffixing the newcomer. */
export function addToken(info: CoinInfo): CoinInfo {
  const known = tokenList.find((t) => sameType(t.type, info.type));
  if (known) return known;
  const key = tokenList.some((t) => t.key === info.key) ? `${info.key}·${info.type.slice(2, 6)}` : info.key;
  const added = { ...info, key };
  tokenList = [...tokenList, added];
  try {
    localStorage.setItem(CUSTOM, JSON.stringify(tokenList.filter((t) => !tokensOf().some((b) => b.key === t.key))));
  } catch {
    // private mode: the token lasts for this visit only
  }
  tokenSubs.forEach((f) => f());
  return added;
}

/** Registry entry for a key; an unknown key (a stale link) falls back to 6 decimals. */
export const coin = (key: CoinKey): CoinInfo =>
  tokenList.find((t) => t.key === key) ?? { key, type: key, symbol: key, name: key, decimals: 6 };
/** Key for a coin type, e.g. a strategy's base: the registry symbol, else the type's last segment. */
export const keyOf = (type: string): CoinKey => tokenList.find((t) => sameType(t.type, type))?.key ?? type.split('::').pop() ?? type;
/** Any other token than `key`, for a fresh pair: the first listed. */
export const otherThan = (key: CoinKey): CoinKey => tokenList.find((t) => t.key !== key)?.key ?? key;

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

export type Balances = {
  /** Address balance per token: what allowances can spend. */
  address: Record<CoinKey, bigint>;
  /** Still held as Coin objects: spendable after depositToBalance. */
  coins: Record<CoinKey, bigint>;
  /** Total SUI, for gas. */
  gas: bigint;
};

/** The connected wallet's balances for every known token, in one call. null = no wallet. */
export function useBalances(): Poll<Balances | null> {
  const me = useCurrentAccount()?.address;
  const client = useCurrentClient();
  const list = useTokens();
  return usePoll(async () => {
    if (!me) return null;
    const { balances } = await client.listBalances({ owner: me });
    const byType = new Map(balances.map((b) => [normalizeType(b.coinType), b]));
    const out: Balances = { address: {}, coins: {}, gas: 0n };
    for (const t of list) {
      const b = byType.get(normalizeType(t.type));
      out.address[t.key] = BigInt(b?.addressBalance ?? 0);
      out.coins[t.key] = BigInt(b?.coinBalance ?? 0);
    }
    out.gas = BigInt(byType.get(normalizeType('0x2::sui::SUI'))?.balance ?? 0);
    return out;
  }, [me, client, list]);
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
  const list = useTokens();
  return usePoll(
    async () => {
      if (!me) return null;
      // ponytail: one AllowanceCap query per known token; one typed query if the list grows large
      const [caps, listed] = await Promise.all([
        Promise.all(list.map(async (t) => (await listAllowanceCaps(me, t.type)).map((c) => ({ ...c, coin: t.key })))).then((x) => x.flat()),
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
    [me, client, list],
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
  // Full coin types, so tokens this browser added by hand quote too (the server only knows its registry's symbols).
  const { status, data } = await call('/v1/quote', { ...req, sell: coin(req.sell).type, buy: coin(req.buy).type });
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
 * `created('::order::SwapOrder<')` returns the id of a new object whose type contains every fragment
 * (addresses compared padded, so `0x2::sui::SUI` matches however the node spells it).
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
          effects.changedObjects.find((c) => c.idOperation === 'Created' && fragments.every((f) => normalizeType(objectTypes[c.objectId] ?? '').includes(normalizeType(f))))?.objectId ?? '',
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
