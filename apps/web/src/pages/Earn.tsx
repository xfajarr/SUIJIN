import { useCurrentAccount } from '@mysten/dapp-kit-react';
import {
  createStrategies,
  curveReservesFor,
  fixedPriceFor,
  issueAllowances,
  normalizeType,
  orient,
  priceOf,
  type CoinKey,
  type StrategySpec,
} from '@suijin/sdk';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { coin, explorer, friendlyError, openConnect, toast, useBalances, useNow, usePositions, useQuotes, useRun, type Budget } from '../chain';
import {
  AmountPanel,
  Check,
  CoinIcon,
  Options,
  Segmented,
  Skeleton,
  Steps,
  TokenPicker,
  TxLink,
  cleanAmount,
  fmtAmt,
  fmtPrice,
  parseAmount,
  parsePrice,
  priceText,
  toInput,
  type StepState,
} from '../ui';
import { budgetRatio } from './Portfolio';
import { BalanceHint } from './trade';
import { PriceChart } from './PriceChart';
import './provide.css';

const HOUR = 3_600_000;
const U64_MAX = 18_446_744_073_709_551_615n;
/** The demo pair opens at 150 when nobody quotes yet; other pairs start empty. */
const DEMO_PRICE = 150_000_000n;

/** The market a provider selling `sell` for `receive` makes. */
export const pairFor = (sell: CoinKey, receive: CoinKey) => ({ base: coin(sell).type, quote: coin(receive).type });
/** One whole token in raw units. */
export const oneOf = (key: CoinKey) => 10n ** BigInt(coin(key).decimals);
/** Raw amount -> float of whole tokens, for previews only. */
export const whole = (v: bigint, key: CoinKey) => Number(v) / 10 ** coin(key).decimals;
/** Decimals of the two sides of a pair, as the SDK price helpers take them. */
export const decimalsOf = (unit: CoinKey, priced: CoinKey) => ({ unitDecimals: coin(unit).decimals, pricedDecimals: coin(priced).decimals });

/** The pair's display order ("1 unit = P priced") for two token keys. */
export function orientKeys(a: CoinKey, b: CoinKey) {
  const o = orient(coin(a), coin(b));
  return { unit: o.unit.key, priced: o.priced.key };
}

// Small amounts keep 4 significant digits (0.006646), so a tiny budget never reads as 0.
const num = (x: number) =>
  Math.abs(x) >= 1 || x === 0 ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : x.toLocaleString('en-US', { maximumSignificantDigits: 4 });
const compact = (v: bigint, key: CoinKey) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(whole(v, key));
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Live prices for a pair as "1 unit = P priced" (PRICE_SCALE): `pricedOut` is what a trader gets
 * buying priced with one unit, `pricedIn` what a trader pays for one unit. Null when nobody quotes that side.
 */
export function useMarketPrice(unit: CoinKey, priced: CoinKey) {
  const one = oneOf(unit);
  const dec = decimalsOf(unit, priced);
  const buyPriced = useQuotes({ sell: unit, buy: priced, amountIn: one, slippageBps: 50 });
  const buyUnit = useQuotes({ sell: priced, buy: unit, amountOut: one, slippageBps: 0 });
  const pricedOut = buyPriced.best ? priceOf({ ...dec, unitAmount: one, pricedAmount: buyPriced.best.baseOut }) : null;
  const pricedIn = buyUnit.best ? priceOf({ ...dec, unitAmount: one, pricedAmount: buyUnit.best.quoteIn }) : null;
  const mid = pricedOut !== null && pricedIn !== null ? (pricedOut + pricedIn) / 2n : (pricedOut ?? pricedIn);
  return { pricedOut, pricedIn, mid, loading: buyPriced.loading || buyUnit.loading };
}

type Shape = 'curve' | 'fixed';

/**
 * One side's strategy on the pair "1 unit = P priced": sells `coin` (unit or priced) for the other.
 * The fee tier is the curve fee, or the spread baked into a fixed price.
 */
function specFor(p: {
  coin: CoinKey;
  unit: CoinKey;
  priced: CoinKey;
  allowanceId: string;
  amount: bigint;
  price: bigint;
  shape: Shape;
  feeBps: number;
  depth: number;
  expiresAtMs: number;
}): StrategySpec {
  const f = BigInt(p.feeBps);
  const sell = p.coin === p.priced ? 'priced' : 'unit';
  const dec = decimalsOf(p.unit, p.priced);
  const receive = sell === 'priced' ? p.unit : p.priced;
  const common = { allowanceId: p.allowanceId, maxBasePerFill: p.amount, virtualBaseLimit: p.amount, expiresAtMs: p.expiresAtMs, pair: pairFor(p.coin, receive) };
  if (p.shape === 'fixed') return { kind: 'fixed', ...common, ...fixedPriceFor({ ...dec, sell, price: p.price, feeBps: f }) };
  return { kind: 'curve', ...common, ...curveReservesFor({ ...dec, sell, price: p.price, amount: p.amount, depth: BigInt(p.depth) }), feeBps: f };
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
        const r = await run(issueAllowances(req.budgets.map((b) => ({ coin: coin(b.coin).type, cap: b.cap, expiresAtMs: b.expiresAtMs }))));
        for (const b of req.budgets) {
          const id = r.created('::allowance::Allowance<', `${normalizeType(coin(b.coin).type)}>`);
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

/** "1 unit = [ ] priced". null value = still loading the market price. */
export function PriceField(p: {
  label: string;
  unit: CoinKey;
  priced: CoinKey;
  value: string | null;
  onChange: (v: string) => void;
  chips?: ReactNode;
  hint?: ReactNode;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className="fieldset">
      <div className="spread">
        <label htmlFor={id}>{p.label}</label>
        {p.chips}
      </div>
      <div className={`affix${p.invalid ? ' invalid' : ''}`}>
        <span>1 {p.unit} =</span>
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
            onChange={(e) => p.onChange(cleanAmount(e.target.value, 6))}
          />
        )}
        <span>{p.priced}</span>
      </div>
      {p.hint && <span className="hint">{p.hint}</span>}
    </div>
  );
}

// ---------- page ----------

type Sides = 'both' | CoinKey;
const sideCards = (unit: CoinKey, priced: CoinKey): { value: Sides; title: string; caption: string; icon: ReactNode }[] => [
  {
    value: 'both',
    title: 'Both sides',
    caption: 'Earn from both directions',
    icon: (
      <span className="coin-pair">
        <CoinIcon coin={priced} size={20} />
        <CoinIcon coin={unit} size={20} />
      </span>
    ),
  },
  { value: priced, title: `Sell ${priced}`, caption: `Receive ${unit}`, icon: <CoinIcon coin={priced} size={20} /> },
  { value: unit, title: `Sell ${unit}`, caption: `Receive ${priced}`, icon: <CoinIcon coin={unit} size={20} /> },
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
  // What the provider keeps on each trade. Lower = better price for traders, so the router picks you first.
  { value: 5, title: '0.05%', caption: 'Best price for traders: the router picks your market first' },
  { value: 30, title: '0.30%', caption: 'Balanced: a fair price for traders, steady earnings for you' },
  { value: 100, title: '1.00%', caption: 'Most per fill, but traders pick your market less often' },
];
const DEPTHS = [
  // Virtual pool = budget × depth; the budget still caps what can sell. Deeper = flatter price.
  { value: 1, title: 'Very fast', caption: 'Keeps moving and never fully sells: safest for volatile pairs' },
  { value: 5, title: 'Fast', caption: 'Moves 56% by the time all of it sells' },
  { value: 20, title: 'Slow', caption: 'Moves 11% by the time all of it sells: good for most pairs' },
  { value: 100, title: 'Barely', caption: 'Moves 2% by the time all of it sells: close to a fixed price' },
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
  // The pair, as it reads: "1 unit = P priced" (1 tUSD = 150 tJPY, 1 SUI = 3.2 USDC).
  const [unit, setUnit] = useState<CoinKey>('tUSD');
  const [priced, setPriced] = useState<CoinKey>('tJPY');
  const market = useMarketPrice(unit, priced);
  const now = useNow(30_000);
  const flow = useProvideFlow();
  const [sides, setSides] = useState<Sides>('both');
  const [shape, setShape] = useState<Shape>('fixed'); // one price fits steady pairs best
  const [price, setPrice] = useState<string | null>(null);
  const [feeBps, setFeeBps] = useState(30);
  const [depth, setDepth] = useState(20);
  const [hours, setHours] = useState(24);
  const [amounts, setAmounts] = useState<Record<CoinKey, string>>({});
  const [reuse, setReuse] = useState<Record<CoinKey, boolean>>({});

  const setPair = (a: CoinKey, b: CoinKey) => {
    const o = orientKeys(a, b);
    setUnit(o.unit);
    setPriced(o.priced);
    setSides('both');
    setPrice(null);
    setAmounts({});
    setReuse({});
  };

  // Start from the market mid once it loads; the demo pair falls back to 150, others start empty.
  useEffect(() => {
    if (price !== null || market.loading) return;
    const fallback = unit === 'tUSD' && priced === 'tJPY' ? DEMO_PRICE : null;
    const start = market.mid ?? fallback;
    setPrice(start === null ? '' : priceText(start));
  }, [price, market.loading, market.mid, unit, priced]);

  const P = parsePrice(price ?? '');
  const plan: Side[] = (sides === 'both' ? [priced, unit] : [sides]).map((key) => {
    const existing = bestBudget(positions.value?.budgets ?? [], key, now);
    return {
      coin: key,
      existing,
      budget: reuse[key] ? existing : undefined,
      text: amounts[key] ?? '',
      amount: parseAmount(amounts[key] ?? '', coin(key).decimals),
      balance: balances.value?.address[key],
    };
  });
  const expiresAtMs = now + hours * HOUR;
  const missing = plan.find((s) => s.amount === null || s.amount <= 0n);
  const problem = !P || P <= 0n
    ? 'Enter a price'
    : missing
      ? `Enter a ${missing.coin} amount`
      : (plan.map((s) => specProblem(specFor({ coin: s.coin, unit, priced, allowanceId: '', amount: s.amount!, price: P, shape, feeBps, depth, expiresAtMs }))).find(Boolean) ?? null);
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
        plan.map((s) => specFor({ coin: s.coin, unit, priced, allowanceId: ids[s.coin] ?? '', amount: s.amount!, price: P, shape, feeBps, depth, expiresAtMs: endOf(s) })),
      done: plan.length > 1 ? 'Two-sided market is live' : 'Market is live',
    });
  }

  const setReuseFor = (s: Side, on: boolean) => {
    setReuse((r) => ({ ...r, [s.coin]: on }));
    const room = s.existing?.remaining;
    if (on && room && !amounts[s.coin]) setAmounts((a) => ({ ...a, [s.coin]: toInput(room, coin(s.coin).decimals) }));
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
              <Step n={1} title="What you offer">
                <div className="pair-cards" role="group" aria-label="Pair">
                  <TokenPicker
                    variant="card"
                    caption="Token A"
                    label="First token of the pair"
                    value={unit}
                    exclude={priced}
                    onPick={(k) => setPair(k, priced)}
                    balances={balances.value?.address}
                  />
                  <span className="pair-link" aria-hidden="true">
                    /
                  </span>
                  <TokenPicker
                    variant="card"
                    caption="Token B"
                    label="Second token of the pair"
                    value={priced}
                    exclude={unit}
                    onPick={(k) => setPair(unit, k)}
                    balances={balances.value?.address}
                  />
                </div>
                <p className="pair-rate">
                  {market.loading ? 'Reading the market…' : market.mid !== null ? `Market: 1 ${unit} = ${fmtPrice(market.mid)} ${priced}` : `No ${unit}/${priced} market yet: yours would be the first`}
                </p>
                <Options label="What you offer" value={sides} options={sideCards(unit, priced)} onChange={setSides} />
              </Step>

              <Step n={2} title="Price">
                <Options label="Price shape" value={shape} options={SHAPES} onChange={setShape} />
                <PriceStepper price={price} onChange={setPrice} mid={market.mid} loading={market.loading} sides={sides} unit={unit} priced={priced} />
                <div className="knob">
                  <span>Your fee on each fill</span>
                  <Segmented label="Your fee on each fill" value={feeBps} options={FEES.map((o) => ({ value: o.value, label: o.title }))} onChange={setFeeBps} />
                </div>
                <p className="knob-note">{FEES.find((o) => o.value === feeBps)?.caption}</p>
                {shape === 'curve' && (
                  <>
                    <div className="knob">
                      <span>Price moves</span>
                      <Segmented label="How fast your price moves" value={depth} options={DEPTHS.map((o) => ({ value: o.value, label: o.title }))} onChange={setDepth} />
                    </div>
                    <p className="knob-note">{DEPTHS.find((o) => o.value === depth)?.caption}</p>
                  </>
                )}
              </Step>

              <Step n={3} title="Amounts">
                {plan.map((s) => (
                  <SideBudget
                    key={s.coin}
                    s={s}
                    connected={!!account}
                    onText={(v) => setAmounts((a) => ({ ...a, [s.coin]: v }))}
                    onReuse={(on) => setReuseFor(s, on)}
                  />
                ))}
                {plan.map((s) => (
                  <BalanceHint key={`hint-${s.coin}`} coin={s.coin} balances={balances.value} me={account?.address ?? ''} />
                ))}
                <div className="knob">
                  <span>Active for</span>
                  <Segmented label="Active for" value={hours} options={DURATIONS} onChange={setHours} />
                </div>
              </Step>

              <button type="button" className="cta" disabled={!!account && !!problem} onClick={account ? submit : openConnect}>
                {!account
                  ? 'Connect wallet'
                  : (problem ?? (fresh > 0 ? `Grant ${fresh > 1 ? 'budgets' : 'budget'} & open ${markets}` : `Open ${markets} on existing ${plan.length > 1 ? 'budgets' : 'budget'}`))}
              </button>
            </>
          )}
        </section>
        <Preview plan={plan} P={P} unit={unit} priced={priced} shape={shape} feeBps={feeBps} depth={depth} expiresAtMs={expiresAtMs} now={now} />
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
        ? `This budget has ${fmtAmt(room, s.coin)} ${s.coin} left. Fills stop there.`
        : null
      : s.balance !== undefined && s.amount > s.balance
        ? `You hold ${fmtAmt(s.balance, s.coin)} ${s.coin}: only that much can sell until you top up.`
        : null;
  const max = s.budget ? s.budget.remaining : s.balance;
  return (
    <div className="fieldset">
      <AmountPanel
        label={`Sell up to`}
        coin={s.coin}
        value={s.text}
        onChange={onText}
        balance={connected ? (s.balance ?? null) : undefined}
        onMax={max !== undefined && max !== null ? () => onText(toInput(max, coin(s.coin).decimals)) : undefined}
        invalid={s.text !== '' && (s.amount === null || s.amount <= 0n)}
        footer={
          s.existing && (
            <button type="button" className={`reuse${s.budget ? ' on' : ''}`} aria-pressed={!!s.budget} onClick={() => onReuse(!s.budget)}>
              <span className="reuse-box">{s.budget && <Check size={10} />}</span>
              Use my existing {s.coin} budget · {compact(s.existing.remaining ?? 0n, s.coin)} left
            </button>
          )
        }
      />
      {warn && <span className="hint warn">{warn}</span>}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="step-block" aria-label={title}>
      <h3 className="step-head">
        <span className="step-num">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Price text for the stepper: 6 significant digits, so 0.03125 and 150.41 both step cleanly. */
const stepText = (x: number) => String(Number(x.toPrecision(6)));

/** "1 unit = [ 150.41 ] priced" with −/+ steps and a warning when the price is far from the market. */
function PriceStepper(p: {
  price: string | null;
  onChange: (v: string) => void;
  mid: bigint | null;
  loading: boolean;
  sides: Sides;
  unit: CoinKey;
  priced: CoinKey;
}) {
  const id = useId();
  const P = parsePrice(p.price ?? '');
  const mid = p.mid === null ? null : Number(p.mid) / 1e6;
  const cur = P === null ? null : Number(P) / 1e6;
  const step = (dir: 1 | -1) => cur !== null && cur > 0 && p.onChange(stepText(cur * (1 + dir * 0.001)));
  const off = cur !== null && mid ? (cur - mid) / mid : null;
  // Pricing above the market hands traders cheap `priced`; below it hands them cheap `unit`.
  const risky = off !== null && Math.abs(off) >= 0.02;
  const loser = off === null ? null : off > 0 ? p.priced : p.unit;
  const hurts = risky && (p.sides === 'both' || p.sides === loser);
  return (
    <div className="fieldset">
      <div className="spread">
        <label htmlFor={id} className="field-label">
          Your price
        </label>
        {mid !== null && (
          <button type="button" className="chip-btn" onClick={() => p.onChange(priceText(p.mid!))}>
            Use market
          </button>
        )}
      </div>
      <div className="stepper">
        <button type="button" className="step-btn" onClick={() => step(-1)} aria-label="Lower price by 0.1%">
          −
        </button>
        <label htmlFor={id} className={`stepper-field${P !== null && P <= 0n ? ' invalid' : ''}`}>
          <span className="unit-pre">
            <CoinIcon coin={p.unit} size={18} />1 {p.unit} =
          </span>
          {p.price === null ? (
            <Skeleton w={90} h={24} />
          ) : (
            <input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="0.00"
              value={p.price}
              onChange={(e) => p.onChange(cleanAmount(e.target.value, 6))}
            />
          )}
          <span className="unit-post">
            {p.priced}
            <CoinIcon coin={p.priced} size={18} />
          </span>
        </label>
        <button type="button" className="step-btn" onClick={() => step(1)} aria-label="Raise price by 0.1%">
          +
        </button>
      </div>
      <span className="spread small muted">
        <span>
        {p.loading ? 'Loading market…' : mid !== null ? <>Market <b className="ink">{num(mid)}</b></> : 'No live market yet'}
        {off !== null && Math.abs(off) >= 0.0005 && (
          <span className={`pv-tag${hurts ? ' bad-tag' : ''}`}>
            {off > 0 ? '+' : '−'}
            {Math.abs(off * 100).toFixed(1)}% vs market
          </span>
        )}
        </span>
        {cur !== null && cur > 0 && (
          <span className="faint">
            1 {p.priced} = {num(1 / cur)} {p.unit}
          </span>
        )}
      </span>
      {hurts && (
        <span className="hint warn">
          Traders would buy your {loser} {Math.abs(off! * 100).toFixed(0)}% cheaper than the market. Move closer to {num(mid!)} unless you mean it.
        </span>
      )}
    </div>
  );
}

function Preview(p: {
  plan: Side[];
  P: bigint | null;
  unit: CoinKey;
  priced: CoinKey;
  shape: Shape;
  feeBps: number;
  depth: number;
  expiresAtMs: number;
  now: number;
}) {
  const { plan, P, unit, priced, shape, feeBps, depth, expiresAtMs, now } = p;
  const Pn = P !== null && P > 0n ? Number(P) / 1e6 : null;
  const fee = feeBps / 10_000;
  // Selling all of a budget off a curve costs traders m/(m-1) times the no-impact amount.
  const curveTotal = depth > 1 ? depth / (depth - 1) : null;
  const feeLabel = FEES.find((f) => f.value === feeBps)?.title;
  return (
    <aside className="card preview" aria-label="Your position">
      <div className="card-head">
        <h2>Your position</h2>
        <span className="chip">
          {shape === 'curve' ? 'Curve' : 'Fixed'} · {feeLabel}
        </span>
      </div>
      {plan.map((s) => {
        const sellsPriced = s.coin === priced;
        const pay = sellsPriced ? unit : priced;
        // Trader price now, in priced per unit.
        const start = Pn === null ? null : sellsPriced ? Pn * (1 - fee) : shape === 'curve' ? Pn / (1 - fee) : Pn * (1 + fee);
        const amount = s.amount ? whole(s.amount, s.coin) : null;
        // What the provider receives if the whole amount sells, and the fee part of it.
        const flat = amount === null || Pn === null ? null : sellsPriced ? amount / Pn : amount * Pn;
        const total = flat === null ? null : shape === 'fixed' ? flat * (sellsPriced ? 1 / (1 - fee) : 1 + fee) : curveTotal === null ? null : (flat * curveTotal) / (1 - fee);
        const feePart = total === null || flat === null ? null : shape === 'fixed' ? total - flat : total * fee;
        const shared = s.budget && s.amount ? budgetRatio(s.budget, s.balance, now, s.amount) : null;
        const dash = <span className="faint">—</span>;
        // Returns against selling the same amount at the market price (`flat`).
        const pctOf = (x: number) => `+${(flat ? (x / flat) * 100 : 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
        return (
          <div className="preview-side" key={s.coin}>
            <div className="pv-title">
              <CoinIcon coin={s.coin} size={22} />
              <b>
                Sell {s.coin} → get {pay}
              </b>
            </div>
            <div className="kv">
              <span>Price</span>
              <span>
                {start === null ? (
                  dash
                ) : (
                  <b>
                    1 {unit} = {num(start)} {priced}
                  </b>
                )}
                {start !== null && Pn !== null && (
                  <span className="pv-tag">
                    {sellsPriced ? '−' : '+'}
                    {feeLabel} spread
                  </span>
                )}
              </span>
            </div>
            <div className="kv">
              <span>You sell</span>
              <span>
                {amount === null ? (
                  dash
                ) : (
                  <b>
                    up to {fmtAmt(s.amount!, s.coin)} {s.coin}
                  </b>
                )}
              </span>
            </div>
            <div className="kv pv-total">
              <span>You get</span>
              <span>
                {total !== null ? (
                  <>
                    <b className="gold">
                      ≈ {num(total)} {pay}
                    </b>
                    {shape === 'curve' && flat !== null && <span className="pv-tag up">{pctOf(total - flat)} vs your price</span>}
                  </>
                ) : amount !== null ? (
                  <span className="faint">never fully sells</span>
                ) : (
                  dash
                )}
              </span>
            </div>
            <div className="kv">
              <span>Fee earned</span>
              <span>
                {feePart === null || total === null ? (
                  dash
                ) : (
                  <>
                    <b>
                      ≈ {num(feePart)} {pay}
                    </b>
                    <span className="pv-tag up">{pctOf(feePart)}</span>
                  </>
                )}
              </span>
            </div>
            {shared && (
              <div className="kv">
                <span>Shared budget</span>
                <span className="gold">
                  <b>
                    {shared.markets} markets · {shared.ratio.toFixed(1)}×
                  </b>
                </span>
              </div>
            )}
            {shape === 'curve' && amount !== null && Pn !== null && (
              <PriceChart coin={s.coin} unit={unit} priced={priced} amount={amount} mid={Pn} fee={fee} shape={shape} depth={depth} />
            )}
          </div>
        );
      })}
      <p className="pv-foot">
        Funds stay in your wallet · revoke anytime · ends <b className="ink">{when(expiresAtMs)}</b>
      </p>
    </aside>
  );
}
