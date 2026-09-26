import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { BPS, DEPLOYMENT, listFills, revokeAllowance, setStrategyActive, type FillEvent, type StrategyState } from '@suijin/sdk';
import { useState, type ReactNode } from 'react';
import { COINS, COIN_KEYS, keyOf, openConnect, useAction, useBalances, useNow, usePoll, usePositions, type Approval, type Budget } from '../chain';
import { Addr, CoinIcon, Empty, Meter, Skeleton, Tabs, TxLink, ago, fmt, pct, until } from '../ui';
import './portfolio.css';
import './provide.css'; // MarketRow (still used by Limit) styles its actions there

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
      <span className="dot" />
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

// ---------- page ----------

type Tab = 'markets' | 'budgets' | 'activity' | 'approvals';

/** First `n` rows, with a Show all / Show fewer toggle when there are more. */
function useClamp<T>(items: T[], n: number) {
  const [all, setAll] = useState(false);
  return {
    shown: all ? items : items.slice(0, n),
    toggle:
      items.length > n ? (
        <button type="button" className="act pf-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      ) : null,
  };
}

const isLive = (b: Budget, now: number) => Number(b.allowance.expirationMs ?? 0n) > now && b.remaining !== 0n;

export function Portfolio() {
  const account = useCurrentAccount();
  const me = account?.address.toLowerCase() ?? '';
  const balances = useBalances();
  const positions = usePositions();
  const fills = usePoll(() => listFills(DEPLOYMENT, 50), [], 10_000);
  const now = useNow(15_000);
  const actions = useAction();
  const [tab, setTab] = useState<Tab>('markets');

  const p = positions.value;
  const bal = balances.value;
  const markets = p ? marketsOf(p.strategies, p.budgets, now) : [];
  const budgets = p ? [...p.budgets].sort((a, b) => Number(isLive(b, now)) - Number(isLive(a, now))) : [];
  const approvals = p?.approvals ?? [];
  const mine = (fills.value ?? []).filter((f) => [f.maker, f.taker, f.recipient].some((a) => a.toLowerCase() === me));
  const marketRows = useClamp(markets, 8);
  const budgetRows = useClamp(budgets, 8);
  const activityRows = useClamp(mine, 10);

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
  const receivedCoins = COIN_KEYS.filter((c) => received[c] > 0n);
  const loading = <Skeleton w={64} h={22} />;

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'markets', label: 'Markets', count: p ? markets.length : undefined },
    { value: 'budgets', label: 'Budgets', count: p ? budgets.length : undefined },
    { value: 'activity', label: 'Activity', count: fills.value ? mine.length : undefined },
    ...(approvals.length > 0 ? [{ value: 'approvals' as const, label: 'Approvals', count: approvals.length }] : []),
  ];
  // The Approvals tab disappears once the last one is revoked: fall back to Markets.
  const current: Tab = tab === 'approvals' && approvals.length === 0 ? 'markets' : tab;

  return (
    <div className="page">
      {head}

      <section className="card pf-summary" aria-label="Summary">
        <div className="pf-group">
          <h2>Balances</h2>
          <div className="pf-balances">
            {COIN_KEYS.map((c) => (
              <div key={c} className="pf-balance">
                <CoinIcon coin={c} size={28} />
                <span className="pf-figure">
                  {bal ? <span className="pf-amount">{fmt(bal[c])}</span> : loading}
                  <span className="pf-symbol">{c}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="pf-group">
          <h2>Liquidity</h2>
          <div className="pf-metrics">
            <Metric label="Live budgets">{p ? budgets.filter((b) => isLive(b, now)).length : loading}</Metric>
            <Metric label="Open markets">{p ? open.length : loading}</Metric>
            <Metric label="Shared liquidity" sub="advertised / executable">
              {p && bal ? <span className="gold">{avgRatio === null ? '—' : `${avgRatio.toFixed(1)}×`}</span> : loading}
            </Metric>
            <Metric label="Received from fills">
              {!p ? (
                loading
              ) : receivedCoins.length === 0 ? (
                '—'
              ) : (
                <span className="pf-received">
                  {receivedCoins.map((c) => (
                    <span key={c}>
                      {fmt(received[c])} <span className="pf-symbol">{c}</span>
                    </span>
                  ))}
                </span>
              )}
            </Metric>
          </div>
        </div>
      </section>
      {positions.error && !p && <p className="hint bad">Could not load positions: {positions.error}</p>}

      <section className="card pf-panel" aria-label="Positions">
        <div className="card-head">
          <Tabs label="Positions" value={current} onChange={setTab} tabs={tabs} />
        </div>

        {current === 'markets' &&
          (!p ? (
            <SkeletonTable cols={7} />
          ) : markets.length === 0 ? (
            <Empty title="No markets yet" action={<a className="btn sm" href="#/earn">Open a market</a>}>
              A market quotes your budget to traders at your price.
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table pf-table">
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th className="r">Price</th>
                      <th>Sold</th>
                      <th className="r">Received</th>
                      <th>Status</th>
                      <th>Ends</th>
                      <th className="r">
                        <span className="pf-sr">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketRows.shown.map((m) => (
                      <MarketTr key={m.s.id} {...m} now={now} actions={actions} />
                    ))}
                  </tbody>
                </table>
              </div>
              {marketRows.toggle}
            </>
          ))}

        {current === 'budgets' &&
          (!p ? (
            <SkeletonTable cols={4} />
          ) : budgets.length === 0 ? (
            <Empty title="No budgets yet" action={<a className="btn sm" href="#/earn">Provide liquidity</a>}>
              A budget lets your wallet back markets without depositing.
            </Empty>
          ) : (
            <>
              <p className="small muted pf-note">Allowances you granted to the executor. Funds stay in your wallet; one budget can back many markets.</p>
              <div className="table-wrap">
                <table className="table pf-table">
                  <thead>
                    <tr>
                      <th>Budget</th>
                      <th>Used</th>
                      <th>Expires</th>
                      <th className="r">
                        <span className="pf-sr">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetRows.shown.map((b) => (
                      <BudgetTr key={b.allowance.id} b={b} balance={bal?.[b.coin]} now={now} actions={actions} />
                    ))}
                  </tbody>
                </table>
              </div>
              {budgetRows.toggle}
            </>
          ))}

        {current === 'activity' &&
          (!fills.value ? (
            fills.error ? <p className="hint bad">Could not load fills: {fills.error}</p> : <SkeletonTable cols={6} />
          ) : mine.length === 0 ? (
            <Empty title="No fills yet" action={<a className="btn sm" href="#/swap">Make a swap</a>}>
              Swaps, payments and fills on your markets show up here.
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table pf-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th className="r">Amount</th>
                      <th className="r">For</th>
                      <th>With</th>
                      <th>When</th>
                      <th className="r">
                        <span className="pf-sr">Transaction</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityRows.shown.map((f) => (
                      <ActivityTr key={`${f.digest}:${f.orderId}`} f={f} me={me} now={now} />
                    ))}
                  </tbody>
                </table>
              </div>
              {activityRows.toggle}
            </>
          ))}

        {current === 'approvals' && (
          <>
            <p className="small muted pf-note">Payment approvals from orders that never settled. Only their own order can use them, until they expire.</p>
            <div className="table-wrap">
              <table className="table pf-table">
                <thead>
                  <tr>
                    <th>Unspent approval</th>
                    <th>Expires</th>
                    <th className="r">
                      <span className="pf-sr">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((a) => (
                    <ApprovalTr key={a.allowance.id} a={a} now={now} actions={actions} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="pf-metric">
      <span className="pf-label">{label}</span>
      <span className="pf-value">{children}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

function SkeletonTable({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <div className="table-wrap" aria-busy="true" aria-label="Loading">
      <table className="table pf-table">
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              {Array.from({ length: cols }, (_, j) => (
                <td key={j}>
                  <Skeleton w={j === 0 ? 150 : 64} h={14} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketTr({ s, status, now, actions }: Market & { now: number; actions: Actions }) {
  const base = keyOf(s.baseType);
  const quote = keyOf(s.quoteType);
  const total = s.baseFilled + s.virtualBaseRemaining;
  const sold = total > 0n ? Number((s.baseFilled * 1000n) / total) / 1000 : 0;
  const live = status === 'open' || status === 'paused';
  const key = `toggle:${s.id}`;
  const toggle = () =>
    actions.act(status === 'open' ? 'Pausing market' : 'Resuming market', () => setStrategyActive(s.id, status !== 'open', { base: s.baseType, quote: s.quoteType }), {
      done: status === 'open' ? 'Market paused' : 'Market live again',
      key,
    });
  return (
    <tr>
      <td>
        <div className="cell">
          <CoinIcon coin={base} size={28} />
          <div>
            <b>
              {base} → {quote}
            </b>
            <span className="sub">{shapeLabel(s)}</span>
          </div>
        </div>
      </td>
      <td className="r">
        {fmt(priceOf(s), 2)}
        <span className="sub">tJPY per tUSD</span>
      </td>
      <td>
        <div className="pf-meter">
          <Meter value={sold} label={`${Math.round(sold * 100)}% sold`} />
        </div>
        <span className="sub">
          {fmt(s.baseFilled)} / {fmt(total)} {base}
        </span>
      </td>
      <td className="r">
        <span className="gold">{fmt(s.quoteReceived)}</span>
        <span className="sub">{quote}</span>
      </td>
      <td>
        <StatusChip status={status} />
      </td>
      <td className="muted">{live ? until(s.expiryMs, now) : '—'}</td>
      <td className="r">
        {live && (
          <button type="button" className="act" disabled={!!actions.busy} onClick={toggle}>
            {actions.busy === key ? (status === 'open' ? 'Pausing…' : 'Resuming…') : status === 'open' ? 'Pause' : 'Resume'}
          </button>
        )}
      </td>
    </tr>
  );
}

function BudgetTr({ b, balance, now, actions }: { b: Budget; balance: bigint | undefined; now: number; actions: Actions }) {
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
    <tr>
      <td>
        <div className="cell">
          <CoinIcon coin={b.coin} size={28} />
          <div>
            <b>{b.coin} budget</b>
            <span className="sub">
              {r.markets} {r.markets === 1 ? 'market' : 'markets'}
              {r.ratio > 1 && <span className="gold"> · {r.ratio.toFixed(1)}× shared</span>}
            </span>
          </div>
        </div>
      </td>
      <td>
        <div className="pf-meter">
          <Meter value={used} hot={used > 0.8} label={`${Math.round(used * 100)}% of budget used`} />
        </div>
        <span className="sub">
          {fmt(spent)} / {cap === null ? 'no cap' : fmt(cap)} {b.coin}
        </span>
      </td>
      <td className={expired ? 'bad' : 'muted'}>{expired ? 'Expired' : until(b.allowance.expirationMs ?? 0n, now)}</td>
      <td className="r">
        <button type="button" className="act danger" disabled={!!actions.busy} onClick={revoke}>
          {actions.busy === key ? 'Revoking…' : 'Revoke'}
        </button>
      </td>
    </tr>
  );
}

function ApprovalTr({ a, now, actions }: { a: Approval; now: number; actions: Actions }) {
  const left = (a.allowance.lifetimeCap ?? 0n) - a.allowance.currentSpend;
  const key = `revoke:${a.allowance.id}`;
  return (
    <tr>
      <td>
        <div className="cell">
          <CoinIcon coin={a.coin} size={28} />
          <b>
            {fmt(left)} {a.coin}
          </b>
        </div>
      </td>
      <td className="muted">{until(a.allowance.expirationMs ?? 0n, now)}</td>
      <td className="r">
        <button
          type="button"
          className="act danger"
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
      </td>
    </tr>
  );
}

/** A fill from this wallet's side: it sold (provider), bought or paid (trader), or was paid (recipient). */
function ActivityTr({ f, me, now }: { f: FillEvent; me: string; now: number }) {
  const is = (a: string) => a.toLowerCase() === me;
  const base = keyOf(f.baseType);
  const quote = keyOf(f.quoteType);
  const row = is(f.maker)
    ? { label: 'Sold', tone: 'gold', who: f.taker }
    : is(f.taker) && is(f.recipient)
      ? { label: 'Bought', tone: 'ok', who: f.maker }
      : is(f.taker)
        ? { label: 'Paid', tone: '', who: f.recipient }
        : { label: 'Received', tone: 'ok', who: f.taker };
  return (
    <tr>
      <td>
        <b className={row.tone}>{row.label}</b>
      </td>
      <td className="r">
        <b>
          {fmt(f.baseOut)} {base}
        </b>
      </td>
      <td className="r muted">
        {fmt(f.quoteIn)} {quote}
      </td>
      <td>
        <Addr a={row.who} />
      </td>
      <td className="muted">{ago(f.timestampMs, now)}</td>
      <td className="r">{f.digest && <TxLink digest={f.digest}>Tx</TxLink>}</td>
    </tr>
  );
}
