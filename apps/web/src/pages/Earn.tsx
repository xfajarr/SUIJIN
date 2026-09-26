import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { BPS, createStrategies, issueAllowances, type CoinKey, type StrategySpec } from '@suijin/sdk';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { COINS, explorer, friendlyError, openConnect, other, toast, useBalances, useNow, usePositions, useQuotes, useRun, type Budget } from '../chain';
import { AmountPanel, Check, CoinIcon, Options, Segmented, Skeleton, Steps, TxLink, cleanAmount, fmt, parseAmount, toInput, type StepState } from '../ui';
import { budgetRatio } from './Portfolio';
import './provide.css';

const HOUR = 3_600_000;
/** One whole coin in base units (both demo coins have 6 decimals). */
export const USD = 1_000_000n;
const DEFAULT_PRICE = 150_000_000n;
const U64_MAX = 18_446_744_073_709_551_615n;

/** The market a provider of `coin` makes: sells `coin`, receives the other one. */
export const pairFor = (coin: CoinKey) =>
  coin === 'tJPY' ? { base: COINS.tJPY.type, quote: COINS.tUSD.type } : { base: COINS.tUSD.type, quote: COINS.tJPY.type };

/** A price for an editable field: "149.55". */
export const priceText = (p: bigint) => fmt(p, 2).replace(/,/g, '');

const num = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 2 });
const compact = (v: bigint) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) / 1e6);
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Live prices in tJPY per 1 tUSD (6-decimal units): `jpyOut` is what a trader gets buying tJPY,
 * `jpyIn` what a trader pays buying tUSD. Null when nobody quotes that side.
 */
export function useMarketPrice() {
  const buyJpy = useQuotes({ sell: 'tUSD', buy: 'tJPY', amountIn: USD, slippageBps: 50 });
  const buyUsd = useQuotes({ sell: 'tJPY', buy: 'tUSD', amountOut: USD, slippageBps: 0 });
  const jpyOut = buyJpy.best?.baseOut ?? null;
  const jpyIn = buyUsd.best?.quoteIn ?? null;
  const mid = jpyOut !== null && jpyIn !== null ? (jpyOut + jpyIn) / 2n : (jpyOut ?? jpyIn);
  return { jpyOut, jpyIn, mid, loading: buyJpy.loading || buyUsd.loading };
}

type Shape = 'curve' | 'fixed';

/** One side's strategy. The fee tier is the curve fee, or the spread baked into a fixed price. */
function specFor(p: { coin: CoinKey; allowanceId: string; amount: bigint; price: bigint; shape: Shape; feeBps: number; depth: number; expiresAtMs: number }): StrategySpec {
  const f = BigInt(p.feeBps);
  const common = { allowanceId: p.allowanceId, maxBasePerFill: p.amount, virtualBaseLimit: p.amount, expiresAtMs: p.expiresAtMs, pair: pairFor(p.coin) };
  if (p.shape === 'fixed') {
    return p.coin === 'tJPY'
      ? { kind: 'fixed', ...common, priceNum: USD * BPS, priceDen: p.price * (BPS - f) }
      : { kind: 'fixed', ...common, priceNum: p.price * (BPS + f), priceDen: USD * BPS };
  }
  const virtualBase = p.amount * BigInt(p.depth);
  const virtualQuote = p.coin === 'tJPY' ? (virtualBase * USD) / p.price : (virtualBase * p.price) / USD;
  return { kind: 'curve', ...common, virtualBase, virtualQuote, feeBps: f };
}

/** Why Move would reject these params, if it would. */
function specProblem(s: StrategySpec): string | null {
  const values = s.kind === 'fixed' ? [s.priceNum, s.priceDen] : [s.virtualBase, s.virtualQuote];
  if (values.some((v) => v <= 0n)) return 'Amount too small for this price';
  if ([...values, s.virtualBaseLimit].some((v) => v > U64_MAX)) return 'Amount too large';
  return null;
}

/** The live budget in `coin` with the most room left: not expiring soon, not spent. */
function bestBudget(budgets: Budget[], coin: CoinKey, now: number): Budget | undefined {
  return budgets
    .filter((b) => b.coin === coin && Number(b.allowance.expirationMs ?? 0n) > now + 10 * 60_000 && (b.remaining === null || b.remaining > 0n))
    .sort((a, b) => ((b.remaining ?? 0n) > (a.remaining ?? 0n) ? 1 : -1))[0];
}

// ---------- the two-transaction provide flow, shared with Limit ----------

export type ProvideRequest = {
  /** New budgets to grant in tx 1. Empty = every side reuses a budget, so tx 1 is skipped. */
  budgets: { coin: CoinKey; cap: bigint; expiresAtMs: number }[];
  reuse: Partial<Record<CoinKey, string>>;
  specs: (allowanceIds: Partial<Record<CoinKey, string>>) => StrategySpec[];
  done: string;
};

type ProvideState = {
  stage: 'idle' | 'grant' | 'open' | 'done' | 'error';
  failedAt?: 'grant' | 'open';
  error?: string;
  req?: ProvideRequest;
  ids?: Partial<Record<CoinKey, string>>;
  grantDigest?: string;
  openDigest?: string;
};

const TYPE_FRAGMENT: Record<CoinKey, string> = { tJPY: '::tjpy::TJPY', tUSD: '::tusd::TUSD' };

/**
 * Tx 1 grants the budgets (allowances are shared objects, so a strategy cannot use one in the same
 * PTB); tx 2 opens the markets on them. A retry resumes at the step that failed.
 */
export function useProvideFlow() {
  const run = useRun();
  const [state, setState] = useState<ProvideState>({ stage: 'idle' });

  async function go(req: ProvideRequest, resume?: ProvideState) {
    let ids: Partial<Record<CoinKey, string>> = { ...req.reuse, ...resume?.ids };
    let grantDigest = resume?.grantDigest;
    let step: 'grant' | 'open' = 'grant';
    try {
      if (req.budgets.length > 0 && !grantDigest) {
        setState({ stage: 'grant', req });
        const r = await run(issueAllowances(req.budgets.map((b) => ({ coin: COINS[b.coin].type, cap: b.cap, expiresAtMs: b.expiresAtMs }))));
        for (const b of req.budgets) {
          const id = r.created('::allowance::Allowance<', TYPE_FRAGMENT[b.coin]);
          if (!id) throw new Error(`The new ${b.coin} budget is missing from the transaction.`);
          ids = { ...ids, [b.coin]: id };
        }
        grantDigest = r.digest;
      }
      step = 'open';
      setState({ stage: 'open', req, ids, grantDigest });
      const r = await run(createStrategies(req.specs(ids)));
      setState({ stage: 'done', req, ids, grantDigest, openDigest: r.digest });
      toast.push({ kind: 'success', title: req.done, href: explorer.tx(r.digest) });
    } catch (e) {
      setState({ stage: 'error', failedAt: step, error: friendlyError(e), req, ids, grantDigest });
    }
  }

  return {
    ...state,
    start: (req: ProvideRequest) => void go(req),
    retry: () => {
      if (state.req) void go(state.req, state);
    },
    reset: () => setState({ stage: 'idle' }),
  };
}

/** Steps while signing, the error with a retry, then the success view with links. */
export function FlowPanel(p: {
  flow: ReturnType<typeof useProvideFlow>;
  grant: { title: string; detail: ReactNode };
  open: { title: string; detail: ReactNode };
  success: { title: string; body: ReactNode };
  again: string;
}) {
  const { flow } = p;
  if (flow.stage === 'done') {
    return (
      <div className="receipt" role="status">
        <span className="receipt-mark">
          <Check size={26} />
        </span>
        <h3>{p.success.title}</h3>
        <p className="muted small">{p.success.body}</p>
        <div className="inline">
          {flow.grantDigest && <TxLink digest={flow.grantDigest}>Budget tx</TxLink>}
          {flow.openDigest && <TxLink digest={flow.openDigest}>Market tx</TxLink>}
        </div>
        <a className="cta" href="#/portfolio">
          View in Portfolio
        </a>
        <div className="inline receipt-actions">
          <a className="link-btn" href="#/swap">
            Trade against it
          </a>
          <button type="button" className="link-btn" onClick={flow.reset}>
            {p.again}
          </button>
        </div>
      </div>
    );
  }
  const state = (step: 'grant' | 'open'): StepState => {
    if (flow.stage === 'error') return flow.failedAt === step ? 'error' : step === 'grant' ? 'done' : 'todo';
    if (flow.stage === step) return 'active';
    return step === 'grant' ? 'done' : 'todo';
  };
  const steps = [...((flow.req?.budgets.length ?? 0) > 0 ? [{ ...p.grant, state: state('grant') }] : []), { ...p.open, state: state('open') }];
  return (
    <div className="stack">
      <Steps steps={steps} />
      {flow.stage === 'error' ? (
        <>
          <p className="hint bad" role="alert">
            {flow.error}
          </p>
          <div className="inline">
            <button type="button" className="btn" onClick={flow.retry}>
              Try again
            </button>
            <button type="button" className="btn ghost" onClick={flow.reset}>
              Back
            </button>
          </div>
        </>
      ) : (
        <p className="hint">Confirm in your wallet…</p>
      )}
    </div>
  );
}

/** "1 tUSD = [ ] tJPY". null value = still loading the market price. */
export function PriceField(p: { label: string; value: string | null; onChange: (v: string) => void; chips?: ReactNode; hint?: ReactNode; invalid?: boolean }) {
  const id = useId();
  return (
    <div className="fieldset">
      <div className="spread">
        <label htmlFor={id}>{p.label}</label>
        {p.chips}
      </div>
      <div className={`affix${p.invalid ? ' invalid' : ''}`}>
        <span>1 tUSD =</span>
        {p.value === null ? (
          <span className="affix-skel">
            <Skeleton w="45%" h={22} />
          </span>
        ) : (
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0"
            value={p.value}
            aria-invalid={p.invalid || undefined}
            onChange={(e) => p.onChange(cleanAmount(e.target.value))}
          />
        )}
        <span>tJPY</span>
      </div>
      {p.hint && <span className="hint">{p.hint}</span>}
    </div>
  );
}

// ---------- page ----------

type Sides = 'both' | CoinKey;
const SIDES: { value: Sides; label: ReactNode }[] = [
  {
    value: 'both',
    label: (
      <span className="side-label">
        <span className="coin-pair">
          <CoinIcon coin="tJPY" size={16} />
          <CoinIcon coin="tUSD" size={16} />
        </span>
        Both sides
      </span>
    ),
  },
  {
    value: 'tJPY',
    label: (
      <span className="side-label">
        <CoinIcon coin="tJPY" size={16} />
        Sell tJPY
      </span>
    ),
  },
  {
    value: 'tUSD',
    label: (
      <span className="side-label">
        <CoinIcon coin="tUSD" size={16} />
        Sell tUSD
      </span>
    ),
  },
];
const CurveIcon = () => (
  <svg width="46" height="22" viewBox="0 0 46 22" fill="none" aria-hidden="true">
    <path d="M3 2.5C7 13 16 18.5 43 19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const FlatIcon = () => (
  <svg width="46" height="22" viewBox="0 0 46 22" fill="none" aria-hidden="true">
    <path d="M3 11h40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const SHAPES: { value: Shape; title: string; caption: string; icon: ReactNode }[] = [
  { value: 'fixed', title: 'Fixed price', caption: 'One price for every fill', icon: <FlatIcon /> },
  { value: 'curve', title: 'Curve', caption: 'Price moves with each fill', icon: <CurveIcon /> },
];
const FEES = [
  { value: 5, title: '0.05%', caption: 'Stable pairs' },
  { value: 30, title: '0.30%', caption: 'Most pairs' },
  { value: 100, title: '1.00%', caption: 'Volatile pairs' },
];
const DEPTHS = [
  // Virtual pool = budget × depth; the budget still caps what can sell. Deeper = flatter price.
  { value: 1, title: 'Full range', caption: 'Never sells out' },
  { value: 5, title: 'Wide', caption: 'Moves up to 56%' },
  { value: 20, title: 'Tight', caption: 'Moves up to 11%' },
  { value: 100, title: 'Pegged', caption: 'Moves up to 2%' },
];
const DURATIONS = [
  { value: 1, label: '1 h' },
  { value: 12, label: '12 h' },
  { value: 24, label: '24 h' },
  { value: 168, label: '7 d' },
];

type Side = {
  coin: CoinKey;
  /** Best live budget in this coin, offered for reuse. */
  existing?: Budget;
  /** The budget this side reuses; undefined = grant a new one. */
  budget?: Budget;
  text: string;
  amount: bigint | null;
  balance?: bigint;
};

export function Earn() {
  const account = useCurrentAccount();
  const balances = useBalances();
  const positions = usePositions();
  const market = useMarketPrice();
  const now = useNow(30_000);
  const flow = useProvideFlow();
  const [sides, setSides] = useState<Sides>('both');
  const [shape, setShape] = useState<Shape>('fixed'); // tUSD/tJPY is a steady FX pair: one price fits best
  const [price, setPrice] = useState<string | null>(null);
  const [feeBps, setFeeBps] = useState(30);
  const [depth, setDepth] = useState(20);
  const [hours, setHours] = useState(24);
  const [amounts, setAmounts] = useState<Record<CoinKey, string>>({ tJPY: '', tUSD: '' });
  const [reuse, setReuse] = useState<Record<CoinKey, boolean>>({ tJPY: false, tUSD: false });

  // Start from the market mid once it loads (150 when nobody quotes yet).
  useEffect(() => {
    if (price === null && !market.loading) setPrice(priceText(market.mid ?? DEFAULT_PRICE));
  }, [price, market.loading, market.mid]);

  const P = parseAmount(price ?? '');
  const plan: Side[] = (sides === 'both' ? (['tJPY', 'tUSD'] as CoinKey[]) : [sides]).map((coin) => {
    const existing = bestBudget(positions.value?.budgets ?? [], coin, now);
    return {
      coin,
      existing,
      budget: reuse[coin] ? existing : undefined,
      text: amounts[coin],
      amount: parseAmount(amounts[coin]),
      balance: balances.value?.[coin],
    };
  });
  const expiresAtMs = now + hours * HOUR;
  const missing = plan.find((s) => s.amount === null || s.amount <= 0n);
  const problem = !P || P <= 0n
    ? 'Enter a price'
    : missing
      ? `Enter a ${missing.coin} amount`
      : (plan.map((s) => specProblem(specFor({ coin: s.coin, allowanceId: '', amount: s.amount!, price: P, shape, feeBps, depth, expiresAtMs }))).find(Boolean) ?? null);
  const fresh = plan.filter((s) => !s.budget).length;
  const markets = plan.length > 1 ? 'markets' : 'market';

  function submit() {
    if (!P || problem) return;
    const exp = Date.now() + hours * HOUR;
    // A strategy on a reused budget must end before that budget does.
    const endOf = (s: Side) => (s.budget ? Math.min(exp, Number(s.budget.allowance.expirationMs ?? 0n) - 60_000) : exp);
    flow.start({
      budgets: plan.filter((s) => !s.budget).map((s) => ({ coin: s.coin, cap: s.amount!, expiresAtMs: exp })),
      reuse: Object.fromEntries(plan.flatMap((s) => (s.budget ? [[s.coin, s.budget.allowance.id] as const] : []))),
      specs: (ids) =>
        plan.map((s) => specFor({ coin: s.coin, allowanceId: ids[s.coin] ?? '', amount: s.amount!, price: P, shape, feeBps, depth, expiresAtMs: endOf(s) })),
      done: plan.length > 1 ? 'Two-sided market is live' : 'Market is live',
    });
  }

  const setReuseFor = (s: Side, on: boolean) => {
    setReuse((r) => ({ ...r, [s.coin]: on }));
    const room = s.existing?.remaining;
    if (on && room && !amounts[s.coin]) setAmounts((a) => ({ ...a, [s.coin]: toInput(room) }));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Earn</h1>
          <p>Quote liquidity from your wallet with a capped budget. Nothing is deposited.</p>
        </div>
      </div>
      <div className="split">
        <section className="card form" aria-label="New market">
          {flow.stage !== 'idle' ? (
            <FlowPanel
              flow={flow}
              grant={{ title: fresh > 1 ? 'Grant 2 budgets' : 'Grant budget', detail: 'An app-bound allowance for the executor. Nothing moves.' }}
              open={{ title: plan.length > 1 ? 'Open 2 markets' : 'Open market', detail: 'Your quotes go live for traders.' }}
              success={{
                title: plan.length > 1 ? 'Your two-sided market is live' : 'Your market is live',
                body: 'Traders now fill against your wallet balance. Track fills and earnings in Portfolio.',
              }}
              again="Open another"
            />
          ) : (
            <>
              <div className="fieldset">
                <span>Sides</span>
                <Segmented label="Sides" full value={sides} options={SIDES} onChange={setSides} />
              </div>
              <div className="fieldset">
                <span>Shape</span>
                <Options label="Shape" value={shape} options={SHAPES} onChange={setShape} />
              </div>
              <PriceField
                label="Price"
                value={price}
                onChange={setPrice}
                invalid={price !== null && price !== '' && (!P || P <= 0n)}
                chips={
                  market.mid !== null && (
                    <button type="button" className="chip-btn" onClick={() => setPrice(priceText(market.mid!))}>
                      Market
                    </button>
                  )
                }
                hint={market.loading ? 'Loading the market price…' : market.mid !== null ? `Market ${fmt(market.mid, 2)} tJPY` : 'No live market yet: 150 is a starting point.'}
              />
              <div className="fieldset">
                <span>{shape === 'curve' ? 'Fee tier' : 'Spread'}</span>
                <Options label={shape === 'curve' ? 'Fee tier' : 'Spread'} value={feeBps} options={FEES} onChange={setFeeBps} />
              </div>
              {shape === 'curve' && (
                <div className="fieldset">
                  <span>Depth</span>
                  <Options label="Depth" value={depth} options={DEPTHS} onChange={setDepth} />
                  <span className="hint">
                    {depth === 1
                      ? 'Spread over every price. It never fully sells out.'
                      : `Depth ${depth}× your budget: tighter prices, and the price moves at most ${num((depth / (depth - 1)) ** 2)}× before it sells out.`}
                  </span>
                </div>
              )}
              {plan.map((s) => (
                <SideBudget
                  key={s.coin}
                  s={s}
                  connected={!!account}
                  onText={(v) => setAmounts((a) => ({ ...a, [s.coin]: v }))}
                  onReuse={(on) => setReuseFor(s, on)}
                />
              ))}
              <div className="fieldset">
                <span>Duration</span>
                <Segmented label="Duration" full value={hours} options={DURATIONS} onChange={setHours} />
              </div>
              <button type="button" className="cta" disabled={!!account && !!problem} onClick={account ? submit : openConnect}>
                {!account
                  ? 'Connect wallet'
                  : (problem ?? (fresh > 0 ? `Grant ${fresh > 1 ? 'budgets' : 'budget'} & open ${markets}` : `Open ${markets} on existing ${plan.length > 1 ? 'budgets' : 'budget'}`))}
              </button>
            </>
          )}
        </section>
        <Preview plan={plan} P={P} shape={shape} feeBps={feeBps} depth={depth} expiresAtMs={expiresAtMs} now={now} />
      </div>
    </div>
  );
}

function SideBudget({ s, connected, onText, onReuse }: { s: Side; connected: boolean; onText: (v: string) => void; onReuse: (on: boolean) => void }) {
  const room = s.budget?.remaining ?? null;
  const warn = !s.amount
    ? null
    : s.budget
      ? room !== null && s.amount > room
        ? `This budget has ${fmt(room)} ${s.coin} left. Fills stop there.`
        : null
      : s.balance !== undefined && s.amount > s.balance
        ? `Your wallet holds ${fmt(s.balance)} ${s.coin}: only that much is usable until you top up.`
        : null;
  const max = s.budget ? s.budget.remaining : s.balance;
  return (
    <div className="fieldset">
      {s.existing && (
        <Segmented
          label={`${s.coin} budget source`}
          full
          value={s.budget ? 'existing' : 'new'}
          options={[
            { value: 'new', label: 'New budget' },
            { value: 'existing', label: `Existing · ${compact(s.existing.remaining ?? 0n)} left` },
          ]}
          onChange={(v) => onReuse(v === 'existing')}
        />
      )}
      <AmountPanel
        label={s.budget ? `Sell up to, from your ${s.coin} budget` : `${s.coin} budget`}
        coin={s.coin}
        value={s.text}
        onChange={onText}
        balance={connected ? (s.balance ?? null) : undefined}
        onMax={max !== undefined && max !== null ? () => onText(toInput(max)) : undefined}
        invalid={s.text !== '' && (s.amount === null || s.amount <= 0n)}
      />
      {warn && <span className="hint warn">{warn}</span>}
    </div>
  );
}

function Preview({ plan, P, shape, feeBps, depth, expiresAtMs, now }: { plan: Side[]; P: bigint | null; shape: Shape; feeBps: number; depth: number; expiresAtMs: number; now: number }) {
  const Pn = P !== null && P > 0n ? Number(P) / 1e6 : null;
  const fee = feeBps / 10_000;
  // Price multiple once the whole budget is sold: (m / (m - 1))² on a curve with m× virtual depth.
  const move = depth > 1 ? (depth / (depth - 1)) ** 2 : null;
  const feeLabel = FEES.find((f) => f.value === feeBps)?.title;
  return (
    <aside className="card preview" aria-label="Preview">
      <div className="card-head">
        <h2>What traders see</h2>
        {plan.length > 1 && <span className="chip accent">Two-sided</span>}
      </div>
      {plan.map((s) => {
        const sellsJpy = s.coin === 'tJPY';
        const trade =
          Pn === null ? '—' : sellsJpy ? `1 tUSD → ${num(Pn * (1 - fee))} tJPY` : `${num(shape === 'curve' ? Pn / (1 - fee) : Pn * (1 + fee))} tJPY → 1 tUSD`;
        // Trader price now (after fee) and once the budget is sold, in tJPY per tUSD.
        const start = Pn === null ? null : sellsJpy ? Pn * (1 - fee) : Pn / (1 - fee);
        const end = start === null || move === null ? null : sellsJpy ? start / move : start * move;
        const shared = s.budget && s.amount ? budgetRatio(s.budget, s.balance, now, s.amount) : null;
        return (
          <div className="preview-side" key={s.coin}>
            <div className="spread">
              <span className="inline">
                <CoinIcon coin={s.coin} size={22} />
                <b>Sells {s.coin}</b>
                <span className="muted small">for {other(s.coin)}</span>
              </span>
              <span className="chip">
                {shape === 'curve' ? 'Curve' : 'Fixed'} · {feeLabel}
              </span>
            </div>
            <div className="big gold">
              {s.amount ? fmt(s.amount) : '0'} <span className="unit">{s.coin}</span>
            </div>
            <div className="kv">
              <span>Trader price</span>
              <span>{trade}</span>
            </div>
            {shape === 'curve' && start !== null && (
              <div className="range">
                <div className="spread small">
                  <span className="muted">Price range</span>
                  <span className="faint">tJPY per tUSD</span>
                </div>
                <div className={`range-track${end === null ? ' open' : ''}`} aria-hidden="true" />
                <div className="spread small">
                  <span>
                    <b className="num">{num(start)}</b> <span className="faint">now</span>
                  </span>
                  <span>
                    {end === null ? <span className="faint">never sells out</span> : (
                      <>
                        <b className="num">{num(end)}</b> <span className="faint">sold out</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            )}
            <div className="kv">
              <span>Budget</span>
              <span>{s.budget ? `Existing, ${fmt(s.budget.remaining ?? 0n)} ${s.coin} left` : 'New, capped at this amount'}</span>
            </div>
            {shared && (
              <div className="kv">
                <span>One balance, many markets</span>
                <span className="gold">
                  {shared.markets} markets · {shared.ratio.toFixed(1)}× shared
                </span>
              </div>
            )}
          </div>
        );
      })}
      <p className="small muted" style={{ margin: 0, lineHeight: 1.55 }}>
        Funds stay in your wallet. The executor can pull only through suijin's Move rules, up to each budget, until {when(expiresAtMs)}. Pause
        or revoke any time in Portfolio.
      </p>
    </aside>
  );
}
