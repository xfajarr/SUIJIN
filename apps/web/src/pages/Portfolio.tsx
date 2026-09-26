import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { BPS, DEPLOYMENT, listFills, revokeAllowance, setStrategyActive, type FillEvent, type StrategyState } from '@suijin/sdk';
import { useState, type ReactNode } from 'react';
import { COINS, keyOf, openConnect, useAction, useBalances, useNow, usePoll, usePositions, type Approval, type Budget } from '../chain';
import { Addr, CoinIcon, Empty, Meter, Skeleton, TxLink, ago, fmt, pct, until } from '../ui';
import './provide.css';

// Position math and rows shared with Earn and Limit live here, next to the page that lists them all.

const USD = 1_000_000n;

/** Current price in tJPY per 1 tUSD (6-decimal units): the fixed rate, or the curve's marginal price after fee. */
export function priceOf(s: StrategyState): bigint {
  const sellsJpy = keyOf(s.baseType) === 'tJPY';
  if (s.kind === 'fixed') return sellsJpy ? (s.priceDen * USD) / s.priceNum : (s.priceNum * USD) / s.priceDen;
  const keep = BPS - s.feeBps;
  return sellsJpy ? (s.virtualBase * USD * keep) / (s.virtualQuote * BPS) : (s.virtualQuote * USD * BPS) / (s.virtualBase * keep);
}

export const shapeLabel = (s: StrategyState) => (s.kind === 'curve' ? `Curve · ${pct(s.feeBps)}` : 'Fixed price');

export type MarketStatus = 'open' | 'paused' | 'drained' | 'filled' | 'expired' | 'closed';

/** closed = its budget was revoked; drained = the budget is spent, so it cannot fill any more. */
export function marketStatus(s: StrategyState, budget: Budget | undefined, now: number): MarketStatus {
  if (!budget) return 'closed';
  if (s.virtualBaseRemaining === 0n) return 'filled';
  if (Number(s.expiryMs) <= now || Number(budget.allowance.expirationMs ?? 0n) <= now) return 'expired';
  if (budget.remaining === 0n) return 'drained';
  return s.active ? 'open' : 'paused';
}

const STATUS: Record<MarketStatus, { label: string; tone: string; rank: number }> = {
  open: { label: 'Open', tone: 'accent', rank: 0 },
  paused: { label: 'Paused', tone: 'gold', rank: 1 },
  drained: { label: 'Budget used', tone: 'gold', rank: 2 },
  filled: { label: 'Filled', tone: '', rank: 3 },
  expired: { label: 'Expired', tone: '', rank: 4 },
  closed: { label: 'Closed', tone: '', rank: 5 },
};

export function StatusChip({ status, order }: { status: MarketStatus; order?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={`chip ${s.tone}`}>
      <span className={`dot${status === 'open' ? ' live' : ''}`} />
      {order && status === 'closed' ? 'Cancelled' : s.label}
    </span>
  );
}

export type Market = { s: StrategyState; budget?: Budget; status: MarketStatus };

/** Pairs each strategy with its budget; live markets first. */
export function marketsOf(strategies: StrategyState[], budgets: Budget[], now: number): Market[] {
  return strategies
    .map((s) => {
      const budget = budgets.find((b) => b.allowance.id === s.makerAllowanceId);
      return { s, budget, status: marketStatus(s, budget, now) };
    })
    .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank);
}

/**
 * Shared liquidity of one budget: what its live markets advertise over what can really settle,
 * min(wallet balance, budget left). `extra` previews one more market of that size.
 */
export function budgetRatio(b: Budget, balance: bigint | undefined, now: number, extra = 0n) {
  const bal = balance ?? 0n;
  const executable = b.remaining !== null && b.remaining < bal ? b.remaining : bal;
  const cap = (v: bigint) => (v < executable ? v : executable);
  const live = b.markets.filter((s) => s.active && Number(s.expiryMs) > now && s.virtualBaseRemaining > 0n);
  const advertised = live.reduce((sum, s) => sum + cap(s.virtualBaseRemaining), cap(extra));
  return {
    markets: live.length + (extra > 0n ? 1 : 0),
    executable,
    ratio: executable > 0n ? Number((advertised * 100n) / executable) / 100 : 0,
  };
}

export function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="item">
          <Skeleton w="50%" h={16} />
          <Skeleton h={6} />
          <Skeleton w="72%" h={12} />
        </li>
      ))}
    </ul>
  );
}

type Actions = ReturnType<typeof useAction>;

/** One market (strategy). `order` phrases it as a limit order and offers Cancel when the budget is its own. */
export function MarketRow({ s, budget, status, now, actions, order }: Market & { now: number; actions: Actions; order?: boolean }) {
  const base = keyOf(s.baseType);
  const quote = keyOf(s.quoteType);
  const total = s.baseFilled + s.virtualBaseRemaining;
  const sold = total > 0n ? Number((s.baseFilled * 1000n) / total) / 1000 : 0;
  const live = status === 'open' || status === 'paused';
  const { act, busy } = actions;
  const toggleKey = `toggle:${s.id}`;
  const cancelKey = `cancel:${s.id}`;
  const toggle = () =>
    act(status === 'open' ? 'Pausing' : 'Resuming', () => setStrategyActive(s.id, status !== 'open', { base: s.baseType, quote: s.quoteType }), {
      done: status === 'open' ? 'Paused' : 'Live again',
      key: toggleKey,
    });
  const ownBudget = order && budget && budget.markets.length === 1 ? budget : null;
  const cancel = () =>
    ownBudget &&
    act('Cancelling order', () => revokeAllowance({ coin: COINS[ownBudget.coin].type, allowanceId: ownBudget.allowance.id, capId: ownBudget.capId }), {
      done: 'Order cancelled',
      key: cancelKey,
    });
  return (
    <li className="item">
      <div className="spread">
        <span className="inline">
          <CoinIcon coin={base} size={22} />
          <b>{order ? `Sell ${fmt(total)} ${base}` : `Sells ${base} for ${quote}`}</b>
        </span>
        <StatusChip status={status} order={order} />
      </div>
      <span className="small muted">
        {order ? 'At' : `${shapeLabel(s)} ·`} 1 tUSD = <span className="num">{fmt(priceOf(s), 2)}</span> tJPY
      </span>
      <Meter value={sold} label={`${Math.round(sold * 100)}% sold`} />
      <div className="spread small">
        <span className="muted">
          {order ? (
            `${Math.round(sold * 100)}% filled`
          ) : (
            <>
              Sold <span className="num">{fmt(s.baseFilled)}</span> of {fmt(total)} {base}
            </>
          )}
        </span>
        <span className="muted">
          Received{' '}
          <span className="gold num">
            {fmt(s.quoteReceived)} {quote}
          </span>
        </span>
      </div>
      <div className="spread small muted">
        <span>
          {s.fillCount.toString()} {s.fillCount === 1n ? 'fill' : 'fills'}
          {live && ` · ends in ${until(s.expiryMs, now)}`}
        </span>
        {live && (
          <span className="row-actions">
            <button type="button" className="btn ghost sm" disabled={!!busy} onClick={toggle}>
              {busy === toggleKey ? '…' : status === 'open' ? 'Pause' : 'Resume'}
            </button>
            {ownBudget && (
              <button type="button" className="btn danger sm" disabled={!!busy} onClick={cancel}>
                {busy === cancelKey ? '…' : 'Cancel'}
              </button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

/** First `n` items, with a Show all / Show fewer toggle when there are more. */
function useClamp<T>(items: T[], n = 6) {
  const [all, setAll] = useState(false);
  return {
    shown: all ? items : items.slice(0, n),
    toggle:
      items.length > n ? (
        <button type="button" className="btn ghost sm more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      ) : null,
  };
}

const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="stat">
    <span>{label}</span>
    <span className="inline">{children}</span>
  </div>
);

export function Portfolio() {
  const account = useCurrentAccount();
  const me = account?.address.toLowerCase() ?? '';
  const balances = useBalances();
  const positions = usePositions();
  const fills = usePoll(() => listFills(DEPLOYMENT, 50), [], 10_000);
  const now = useNow(15_000);
  const actions = useAction();

  const p = positions.value;
  const bal = balances.value;
  const markets = p ? marketsOf(p.strategies, p.budgets, now) : [];
  const expired = (b: Budget) => Number(Number(b.allowance.expirationMs ?? 0n) <= now);
  const budgets = p ? [...p.budgets].sort((a, b) => expired(a) - expired(b)) : [];
  const mine = (fills.value ?? []).filter((f) => [f.maker, f.taker, f.recipient].some((a) => a.toLowerCase() === me));
  const budgetList = useClamp(budgets, 5);
  const marketList = useClamp(markets, 6);
  const activity = useClamp(mine, 8);

  const head = (
    <div className="page-head">
      <div>
        <h1>Portfolio</h1>
        <p>Your balances, the budgets behind your markets, and every fill.</p>
      </div>
    </div>
  );

  if (!account) {
    return (
      <div className="page">
        {head}
        <Empty
          title="Connect a wallet"
          action={
            <button type="button" className="btn" onClick={openConnect}>
              Connect wallet
            </button>
          }
        >
          See your balances, the budgets you granted, your markets and every fill.
        </Empty>
      </div>
    );
  }

  const open = markets.filter((m) => m.status === 'open');
  const ratios = (p?.budgets ?? []).map((b) => budgetRatio(b, bal?.[b.coin], now)).filter((r) => r.markets > 0);
  const avgRatio = ratios.length ? ratios.reduce((sum, r) => sum + r.ratio, 0) / ratios.length : null;
  const received = { tUSD: 0n, tJPY: 0n };
  for (const s of p?.strategies ?? []) received[keyOf(s.quoteType)] += s.quoteReceived;
  const liveBudgets = (p?.budgets ?? []).filter((b) => Number(b.allowance.expirationMs ?? 0n) > now && b.remaining !== 0n);
  const loading = <Skeleton w={72} h={20} />;

  return (
    <div className="page">
      {head}
      <section className="card" aria-label="Summary">
        <div className="stats lg">
          {(['tUSD', 'tJPY'] as const).map((c) => (
            <Stat key={c} label={`${c} balance`}>
              {bal ? (
                <>
                  <CoinIcon coin={c} size={18} />
                  {fmt(bal[c])}
                </>
              ) : (
                loading
              )}
            </Stat>
          ))}
          <Stat label="Live budgets">{p ? liveBudgets.length : loading}</Stat>
          <Stat label="Open markets">{p ? open.length : loading}</Stat>
          <Stat label="Shared liquidity">{p && bal ? <span className="gold">{avgRatio === null ? '—' : `${avgRatio.toFixed(1)}×`}</span> : loading}</Stat>
          <Stat label="Received from fills">
            {p ? (
              <span className="small">
                {received.tUSD || received.tJPY ? `${fmt(received.tUSD)} tUSD · ${fmt(received.tJPY)} tJPY` : '—'}
              </span>
            ) : (
              loading
            )}
          </Stat>
        </div>
        {positions.error && !p && <p className="hint bad">Could not load positions: {positions.error}</p>}
      </section>

      <div className="portfolio-grid">
        <div className="stack">
          <section className="card" aria-label="Liquidity budgets">
            <div className="card-head">
              <h2>Liquidity budgets</h2>
              {p && <span className="chip">{liveBudgets.length} live</span>}
            </div>
            <p className="small muted">Allowances you granted to the executor. Funds never leave your wallet; one budget can back many markets.</p>
            {!p ? (
              <SkeletonRows n={2} />
            ) : budgets.length === 0 ? (
              <Empty
                title="No budgets yet"
                action={
                  <a className="btn sm" href="#/earn">
                    Provide liquidity
                  </a>
                }
              >
                A budget lets your wallet back markets without depositing.
              </Empty>
            ) : (
              <>
                <ul className="list">
                  {budgetList.shown.map((b) => (
                    <BudgetRow key={b.allowance.id} b={b} balance={bal?.[b.coin]} now={now} actions={actions} />
                  ))}
                </ul>
                {budgetList.toggle}
              </>
            )}
          </section>

          <section className="card" aria-label="Markets">
            <div className="card-head">
              <h2>Markets</h2>
              {p && <span className="chip accent">{open.length} open</span>}
            </div>
            {!p ? (
              <SkeletonRows n={3} />
            ) : markets.length === 0 ? (
              <Empty
                title="No markets yet"
                action={
                  <a className="btn sm" href="#/earn">
                    Open a market
                  </a>
                }
              >
                Markets quote your budget to traders at your price.
              </Empty>
            ) : (
              <>
                <ul className="list">
                  {marketList.shown.map((m) => (
                    <MarketRow key={m.s.id} {...m} now={now} actions={actions} />
                  ))}
                </ul>
                {marketList.toggle}
              </>
            )}
          </section>
        </div>

        <div className="stack">
          {p && p.approvals.length > 0 && (
            <section className="card" aria-label="Open approvals">
              <div className="card-head">
                <h2>Open approvals</h2>
                <span className="chip gold">{p.approvals.length}</span>
              </div>
              <p className="small muted">Payment approvals from orders that never settled. Only their own order can use them, until they expire.</p>
              <ul className="list">
                {p.approvals.map((a) => (
                  <ApprovalRow key={a.allowance.id} a={a} now={now} actions={actions} />
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-label="Activity">
            <div className="card-head">
              <h2>Activity</h2>
              {fills.value && <span className="chip">{mine.length} {mine.length === 1 ? 'fill' : 'fills'}</span>}
            </div>
            {!fills.value ? (
              fills.error ? (
                <p className="hint bad">Could not load fills: {fills.error}</p>
              ) : (
                <SkeletonRows n={4} />
              )
            ) : mine.length === 0 ? (
              <Empty
                title="No fills yet"
                action={
                  <a className="btn sm" href="#/swap">
                    Make a swap
                  </a>
                }
              >
                Swaps, payments and fills on your markets show up here.
              </Empty>
            ) : (
              <>
                <ul className="list">
                  {activity.shown.map((f) => (
                    <ActivityRow key={`${f.digest}:${f.orderId}`} f={f} me={me} now={now} />
                  ))}
                </ul>
                {activity.toggle}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function BudgetRow({ b, balance, now, actions }: { b: Budget; balance: bigint | undefined; now: number; actions: Actions }) {
  const cap = b.allowance.lifetimeCap;
  const spent = b.allowance.currentSpend;
  const used = cap ? Number((spent * 1000n) / cap) / 1000 : 0;
  const expired = Number(b.allowance.expirationMs ?? 0n) <= now;
  const r = budgetRatio(b, balance, now);
  const key = `revoke:${b.allowance.id}`;
  const revoke = () => {
    const warn = `Revoke this ${b.coin} budget? Its ${r.markets} live ${r.markets === 1 ? 'market stops' : 'markets stop'} filling.`;
    if (r.markets > 0 && !window.confirm(warn)) return;
    actions.act('Revoking budget', () => revokeAllowance({ coin: COINS[b.coin].type, allowanceId: b.allowance.id, capId: b.capId }), {
      done: 'Budget revoked',
      key,
    });
  };
  return (
    <li className="item">
      <div className="spread">
        <span className="inline">
          <CoinIcon coin={b.coin} size={22} />
          <b>{b.coin} budget</b>
          <span className="chip">
            {r.markets} {r.markets === 1 ? 'market' : 'markets'}
          </span>
          {r.ratio > 1 && <span className="chip gold">{r.ratio.toFixed(1)}× shared</span>}
        </span>
        <button type="button" className="btn danger sm" disabled={!!actions.busy} onClick={revoke}>
          {actions.busy === key ? 'Revoking…' : 'Revoke'}
        </button>
      </div>
      <Meter value={used} hot={used > 0.8} label={`${Math.round(used * 100)}% of budget used`} />
      <div className="spread small muted">
        <span>
          Used <span className="num">{fmt(spent)}</span> of {cap === null ? 'no cap' : `${fmt(cap)} ${b.coin}`}
        </span>
        <span className={expired ? 'bad' : ''}>{expired ? 'Expired' : `Expires in ${until(b.allowance.expirationMs ?? 0n, now)}`}</span>
      </div>
    </li>
  );
}

function ApprovalRow({ a, now, actions }: { a: Approval; now: number; actions: Actions }) {
  const left = (a.allowance.lifetimeCap ?? 0n) - a.allowance.currentSpend;
  const key = `revoke:${a.allowance.id}`;
  return (
    <li className="item">
      <div className="spread">
        <span className="inline">
          <CoinIcon coin={a.coin} size={22} />
          <b className="num">
            {fmt(left)} {a.coin}
          </b>
          <span className="small muted">expires in {until(a.allowance.expirationMs ?? 0n, now)}</span>
        </span>
        <button
          type="button"
          className="btn danger sm"
          disabled={!!actions.busy}
          onClick={() =>
            actions.act('Revoking approval', () => revokeAllowance({ coin: COINS[a.coin].type, allowanceId: a.allowance.id, capId: a.capId }), {
              done: 'Approval revoked',
              key,
            })
          }
        >
          {actions.busy === key ? 'Revoking…' : 'Revoke'}
        </button>
      </div>
    </li>
  );
}

/** A fill from this wallet's side: it sold (provider), bought or paid (trader), or was paid (recipient). */
function ActivityRow({ f, me, now }: { f: FillEvent; me: string; now: number }) {
  const is = (a: string) => a.toLowerCase() === me;
  const base = keyOf(f.baseType);
  const quote = keyOf(f.quoteType);
  const out = `${fmt(f.baseOut)} ${base}`;
  const inp = `${fmt(f.quoteIn)} ${quote}`;
  const row = is(f.maker)
    ? { label: 'Sold', tone: 'gold', detail: `for ${inp} to`, who: f.taker }
    : is(f.taker) && is(f.recipient)
      ? { label: 'Bought', tone: 'accent', detail: `for ${inp} from`, who: f.maker }
      : is(f.taker)
        ? { label: 'Paid', tone: '', detail: `cost ${inp} · to`, who: f.recipient }
        : { label: 'Received', tone: 'accent', detail: 'from', who: f.taker };
  return (
    <li className="item">
      <div className="spread">
        <span className="inline">
          <span className={`chip ${row.tone}`}>{row.label}</span>
          <b className="num">{out}</b>
        </span>
        <span className="small muted">{ago(f.timestampMs, now)}</span>
      </div>
      <div className="spread small muted">
        <span>
          {row.detail} <Addr a={row.who} />
        </span>
        {f.digest && <TxLink digest={f.digest}>Tx</TxLink>}
      </div>
    </li>
  );
}
