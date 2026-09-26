import { useCurrentClient } from '@mysten/dapp-kit-react';
import { createTakerOrder, type CoinKey, type Quote } from '@suijin/sdk';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { explorer, friendlyError, keyOf, refreshAll, requestFill, toast, useRun } from '../chain';
import { Addr, Check, Chevron, Segmented, Skeleton, Steps, TxLink, fmt, fmtCoin, pct, rate, type StepState } from '../ui';

// The trader side, shared by Swap and Pay: sign one order, then the executor settles it.

export type FlowStep = 'idle' | 'sign' | 'settle' | 'done' | 'error';

type FlowState = {
  step: FlowStep;
  quote?: Quote;
  recipient?: string;
  orderId?: string;
  allowanceId?: string;
  orderDigest?: string;
  fillDigest?: string;
  /** Settled amounts, read from the Fill event. */
  paid?: bigint;
  received?: bigint;
  failedAt?: 'sign' | 'settle';
  error?: string;
};

const ORDER_TTL_MS = 5 * 60_000;

export function useOrderFlow() {
  const run = useRun();
  const client = useCurrentClient();
  const [s, setS] = useState<FlowState>({ step: 'idle' });

  async function settle(base: FlowState) {
    setS({ ...base, step: 'settle', failedAt: undefined, error: undefined });
    try {
      const fill = await requestFill(base.orderId!, base.allowanceId!);
      if (!fill.ok) throw new Error(fill.error);
      const tx = await client.waitForTransaction({ digest: fill.digest, include: { events: true } });
      const event = tx.$kind === 'Transaction' ? tx.Transaction.events?.find((e) => e.eventType.includes('::settlement::Fill')) : undefined;
      const json = (event?.json ?? {}) as Record<string, unknown>;
      const q = base.quote!;
      const paid = json.quote_in ? BigInt(String(json.quote_in)) : q.quoteIn;
      const received = json.base_out ? BigInt(String(json.base_out)) : q.baseOut;
      setS({ ...base, step: 'done', fillDigest: fill.digest, paid, received });
      refreshAll();
      toast.push({
        kind: 'success',
        title: `Settled ${fmtCoin(paid, keyOf(q.quoteType))} → ${fmtCoin(received, keyOf(q.baseType))}`,
        href: explorer.tx(fill.digest),
      });
    } catch (e) {
      setS({ ...base, step: 'error', failedAt: 'settle', error: friendlyError(e) });
    }
  }

  async function execute(quote: Quote, recipient: string) {
    const base: FlowState = { step: 'sign', quote, recipient };
    setS(base);
    try {
      const placed = await run(
        createTakerOrder({
          strategyId: quote.strategyId,
          quoteIn: quote.quoteIn,
          minBaseOut: quote.minBaseOut,
          quotedBaseOut: quote.baseOut,
          expiresAtMs: Date.now() + ORDER_TTL_MS,
          recipient,
          pair: { base: quote.baseType, quote: quote.quoteType },
        }),
      );
      await settle({
        ...base,
        orderId: placed.created('::order::SwapOrder<'),
        allowanceId: placed.created('::allowance::Allowance<'),
        orderDigest: placed.digest,
      });
    } catch (e) {
      setS({ ...base, step: 'error', failedAt: 'sign', error: friendlyError(e) });
    }
  }

  return {
    ...s,
    execute,
    /** Settlement failed but the order exists: ask the executor again. */
    retrySettle: () => void (s.orderId && settle(s)),
    reset: () => setS({ step: 'idle' }),
  };
}

export type OrderFlow = ReturnType<typeof useOrderFlow>;

/** Signing, settling or failed: the steps plus what to do next. `done` is rendered by the page. */
export function FlowProgress({ flow, payLabel }: { flow: OrderFlow; payLabel: string }) {
  const sign: StepState = flow.step === 'sign' ? 'active' : flow.failedAt === 'sign' ? 'error' : 'done';
  const settle: StepState = flow.step === 'settle' ? 'active' : flow.failedAt === 'settle' ? 'error' : 'todo';
  return (
    <div className="stack">
      <Steps
        steps={[
          { title: 'Sign the order in your wallet', detail: `Exact approval for ${payLabel} plus the order. Nothing moves yet.`, state: sign },
          { title: 'Executor settles', detail: 'Both sides move through Sui allowances in one transaction. It pays the gas.', state: settle },
        ]}
      />
      {flow.step === 'error' && (
        <>
          <p className="hint bad" role="alert">
            {flow.error}
          </p>
          <div className="inline">
            {flow.failedAt === 'settle' && (
              <button type="button" className="btn" onClick={flow.retrySettle}>
                Retry settlement
              </button>
            )}
            <button type="button" className="btn ghost" onClick={flow.reset}>
              Start over
            </button>
          </div>
          {flow.failedAt === 'settle' && (
            <p className="hint">Your approval is unspent and expires in 5 minutes. You can also revoke it in Portfolio.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Success view: drawn check, the settled amounts, both transactions. */
export function Receipt({ flow, title, children, again }: { flow: OrderFlow; title: string; children: ReactNode; again: string }) {
  return (
    <div className="receipt" role="status">
      <span className="receipt-mark">
        <Check size={26} />
      </span>
      <h2 className="receipt-title">{title}</h2>
      <div className="receipt-body">{children}</div>
      <div className="inline small" style={{ justifyContent: 'center' }}>
        {flow.orderDigest && <TxLink digest={flow.orderDigest}>Order</TxLink>}
        {flow.fillDigest && <TxLink digest={flow.fillDigest}>Settlement</TxLink>}
      </div>
      <button type="button" className="cta" onClick={flow.reset}>
        {again}
      </button>
    </div>
  );
}

const SLIPPAGE = [10, 50, 100, 300].map((v) => ({ value: v, label: pct(v) }));

export function SlippageSettings({ value, onChange, note }: { value: number; onChange: (v: number) => void; note: string }) {
  return (
    <div className="settings">
      <div className="spread">
        <span className="small">Slippage tolerance</span>
        <Segmented label="Slippage tolerance" value={value} options={SLIPPAGE} onChange={onChange} />
      </div>
      <p className="hint">{note}</p>
    </div>
  );
}

export const Sliders = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3 6.5h8.5M15.5 6.5H17M3 13.5h1.5M8.5 13.5H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="13.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="6.5" cy="13.5" r="2" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

/** Drains while the quote ages; click to refresh now. Keyed by `updatedAt` so it restarts. */
export function RefreshRing({ updatedAt, ms, onClick }: { updatedAt: number; ms: number; onClick: () => void }) {
  return (
    <button type="button" className="ring" onClick={onClick} aria-label="Refresh quote" title="Refresh quote">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="track" cx="9" cy="9" r="7" />
        <circle key={updatedAt} className="prog" cx="9" cy="9" r="7" style={{ '--ring-ms': `${ms}ms` } as CSSProperties} />
      </svg>
    </button>
  );
}

/** "1 tUSD = 149.55 tJPY", click to invert. */
export function RateLine({ quote, sell, buy, loading }: { quote: Quote | null; sell: CoinKey; buy: CoinKey; loading: boolean }) {
  const [inverted, setInverted] = useState(false);
  if (loading) return <Skeleton w={170} h={14} />;
  if (!quote) return <span className="faint small">No price yet</span>;
  const text = inverted ? `1 ${buy} = ${rate(quote.quoteIn, quote.baseOut)} ${sell}` : `1 ${sell} = ${rate(quote.baseOut, quote.quoteIn)} ${buy}`;
  return (
    <button type="button" className="rate-line" onClick={() => setInverted((v) => !v)} title="Invert price">
      {text}
    </button>
  );
}

const impactClass = (bps: number) => (bps >= 500 ? 'bad' : bps >= 100 ? 'gold' : '');
const routeName = (q: Quote) => (q.kind === 'curve' ? `Curve · ${pct(q.feeBps)} fee` : 'Fixed price');

/** Expandable breakdown plus every executable route; the chosen one settles. */
export function QuoteDetails(p: {
  quote: Quote;
  quotes: Quote[];
  onPick: (strategyId: string) => void;
  sell: CoinKey;
  buy: CoinKey;
  slippageBps: number;
  exactOut: boolean;
  /** Who receives: "You" on Swap, the merchant on Pay. */
  receiver: string;
}) {
  const [open, setOpen] = useState(false);
  const [allRoutes, setAllRoutes] = useState(false);
  const { quote: q } = p;
  const providers = new Set(p.quotes.map((r) => r.maker)).size;
  const routes = allRoutes ? p.quotes : p.quotes.slice(0, 3);
  return (
    <div className="details">
      <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          {p.receiver} get at least{' '}
          <b className="num">{fmtCoin(q.minBaseOut, p.buy)}</b>
        </span>
        <span className="inline small muted">
          {q.impactBps > 0 && <span className={impactClass(q.impactBps)}>Impact {pct(q.impactBps)}</span>}
          <Chevron />
        </span>
      </button>
      {open && (
        <div className="stack details-body">
          <div className="kv">
            <span>You pay (exact)</span>
            <span>
              {fmt(q.quoteIn, 6)} {p.sell}
            </span>
          </div>
          <div className="kv">
            <span>Expected</span>
            <span>{fmtCoin(q.baseOut, p.buy)}</span>
          </div>
          <div className="kv">
            <span>Minimum received</span>
            <span>
              {fmt(q.minBaseOut, 6)} {p.buy}
            </span>
          </div>
          <div className="kv">
            <span>Price impact</span>
            <span className={impactClass(q.impactBps)}>{q.kind === 'fixed' ? 'None (fixed price)' : pct(q.impactBps)}</span>
          </div>
          <div className="kv">
            <span>Provider fee</span>
            <span>{q.kind === 'curve' ? pct(q.feeBps) : 'Included in price'}</span>
          </div>
          <div className="kv">
            <span>{p.exactOut ? 'Price buffer' : 'Slippage tolerance'}</span>
            <span>{pct(p.slippageBps)}</span>
          </div>
          <div className="kv">
            <span>Settlement gas</span>
            <span className="ok">Paid by executor</span>
          </div>
          <div className="route" role="radiogroup" aria-label="Route">
            <span className="small muted">
              Route · {p.quotes.length} {p.quotes.length === 1 ? 'market' : 'markets'} from {providers}{' '}
              {providers === 1 ? 'provider balance' : 'provider balances'}
            </span>
            {routes.map((r, i) => (
              <button
                type="button"
                role="radio"
                aria-checked={r.strategyId === q.strategyId}
                key={r.strategyId}
                className={`route-item${r.strategyId === q.strategyId ? ' best' : ''}`}
                onClick={() => p.onPick(r.strategyId)}
              >
                <span className="stack" style={{ gap: 2, textAlign: 'left' }}>
                  <span className="inline">
                    {routeName(r)}
                    {i === 0 && <span className="chip accent">Best</span>}
                  </span>
                  <span className="faint small">
                    Provider <Addr a={r.maker} />
                  </span>
                </span>
                <span className="num">{p.exactOut ? fmtCoin(r.quoteIn, p.sell) : fmtCoin(r.baseOut, p.buy)}</span>
              </button>
            ))}
            {p.quotes.length > 3 && (
              <button type="button" className="link-btn" onClick={() => setAllRoutes((v) => !v)}>
                {allRoutes ? 'Show fewer' : `Show ${p.quotes.length - 3} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Settled amount line for receipts: "10 tUSD → 1,495.52 tJPY". */
export const settledLine = (flow: OrderFlow) => {
  const q = flow.quote!;
  return (
    <span className="num">
      {fmt(flow.paid ?? q.quoteIn)} {keyOf(q.quoteType)} → <b className="gold">{fmt(flow.received ?? q.baseOut)}</b> {keyOf(q.baseType)}
    </span>
  );
};
