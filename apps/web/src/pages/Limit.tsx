import { useCurrentAccount } from '@mysten/dapp-kit-react';
import type { CoinKey } from '@suijin/sdk';
import { useEffect, useState } from 'react';
import { openConnect, other, useAction, useBalances, useNow, usePositions } from '../chain';
import { AmountPanel, Empty, Segmented, fmt, parseAmount, toInput } from '../ui';
import { FlowPanel, PriceField, USD, pairFor, priceText, useMarketPrice, useProvideFlow } from './Earn';
import { MarketRow, SkeletonRows, marketsOf } from './Portfolio';
import './provide.css';

const HOUR = 3_600_000;
const DURATIONS = [
  { value: 1, label: '1 h' },
  { value: 24, label: '24 h' },
  { value: 168, label: '7 d' },
];
const QUICK = [
  { label: 'Market', edge: 0 },
  { label: '+1%', edge: 0.01 },
  { label: '+5%', edge: 0.05 },
];
const pctText = (x: number) => `${(x * 100).toFixed(2)}%`;
const scale = (v: bigint, k: number) => BigInt(Math.round(Number(v) * k));

export function Limit() {
  const account = useCurrentAccount();
  const balances = useBalances();
  const positions = usePositions();
  const market = useMarketPrice();
  const now = useNow(15_000);
  const flow = useProvideFlow();
  const actions = useAction();
  const [sell, setSell] = useState<CoinKey>('tJPY');
  const [text, setText] = useState('');
  const [price, setPrice] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  // The order competes with this side of the market: a trader buying tJPY gets `jpyOut` per tUSD,
  // a trader buying tUSD pays `jpyIn` per tUSD.
  const ref = sell === 'tJPY' ? market.jpyOut : market.jpyIn;
  useEffect(() => {
    if (price === null && !market.loading) setPrice(priceText(ref ?? 150_000_000n));
  }, [price, market.loading, ref]);

  const buy = other(sell);
  const amount = parseAmount(text);
  const P = parseAmount(price ?? '');
  const balance = balances.value?.[sell];
  const receive = amount !== null && P !== null && P > 0n ? (sell === 'tJPY' ? (amount * USD) / P : (amount * P) / USD) : null;
  // The seller's edge over the market: selling tJPY wants fewer tJPY per tUSD, selling tUSD wants more.
  const edge = P !== null && P > 0n && ref !== null ? (sell === 'tJPY' ? Number(ref) / Number(P) : Number(P) / Number(ref)) - 1 : null;
  const priceAt = (e: number) => ref !== null && setPrice(priceText(sell === 'tJPY' ? scale(ref, 1 / (1 + e)) : scale(ref, 1 + e)));

  const problem =
    amount === null || amount <= 0n ? 'Enter an amount' : P === null || P <= 0n ? 'Enter a price' : !receive ? 'Amount too small for this price' : null;

  function submit() {
    if (!amount || !P || problem) return;
    const exp = Date.now() + hours * HOUR;
    flow.start({
      budgets: [{ coin: sell, cap: amount, expiresAtMs: exp }],
      reuse: {},
      specs: (ids) => [
        {
          kind: 'fixed',
          allowanceId: ids[sell] ?? '',
          // sell tJPY: 1 tUSD buys P tJPY. sell tUSD: P tJPY buys 1 tUSD.
          priceNum: sell === 'tJPY' ? USD : P,
          priceDen: sell === 'tJPY' ? P : USD,
          maxBasePerFill: amount,
          virtualBaseLimit: amount,
          expiresAtMs: exp,
          pair: pairFor(sell),
        },
      ],
      done: 'Limit order placed',
    });
  }

  const orders = positions.value ? marketsOf(positions.value.strategies.filter((s) => s.kind === 'fixed'), positions.value.budgets, now) : [];
  const openCount = orders.filter((o) => o.status === 'open').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Limit orders</h1>
          <p>Sell at your price. The order draws on a budget over your wallet balance, so nothing is locked while it waits.</p>
        </div>
      </div>
      <div className="split">
        <section className="card form" aria-label="New limit order">
          {flow.stage !== 'idle' ? (
            <FlowPanel
              flow={flow}
              grant={{ title: 'Approve budget', detail: `Capped at ${amount ? fmt(amount) : '0'} ${sell}. Nothing moves.` }}
              open={{ title: 'Place order', detail: `Sell at 1 tUSD = ${price ?? '—'} tJPY.` }}
              success={{
                title: 'Limit order placed',
                body: `It fills when it is the best route for a trader. You receive up to ${receive !== null ? fmt(receive) : '0'} ${buy}.`,
              }}
              again="Place another"
            />
          ) : (
            <>
              <AmountPanel
                label="Sell"
                coin={sell}
                value={text}
                onChange={setText}
                onCoin={() => {
                  setSell(buy);
                  setPrice(null);
                }}
                balance={account ? (balance ?? null) : undefined}
                onMax={balance !== undefined ? () => setText(toInput(balance)) : undefined}
                invalid={text !== '' && (amount === null || amount <= 0n)}
                autoFocus
              />
              {amount !== null && balance !== undefined && amount > balance && (
                <span className="hint warn">
                  Your wallet holds {fmt(balance)} {sell}: the order fills up to that.
                </span>
              )}
              <PriceField
                label="Limit price"
                value={price}
                onChange={setPrice}
                invalid={price !== null && price !== '' && (P === null || P <= 0n)}
                chips={
                  ref !== null && (
                    <span className="inline">
                      {QUICK.map((q) => (
                        <button key={q.label} type="button" className="chip chip-btn" onClick={() => priceAt(q.edge)}>
                          {q.label}
                        </button>
                      ))}
                    </span>
                  )
                }
                hint={
                  market.loading ? (
                    'Loading the market price…'
                  ) : ref === null ? (
                    `No live ${buy === 'tJPY' ? 'tUSD' : 'tJPY'} sellers to compare with yet.`
                  ) : (
                    <>
                      Market {fmt(ref, 2)} tJPY
                      {edge !== null &&
                        (Math.abs(edge) < 0.0005 ? (
                          ' · at market'
                        ) : edge > 0 ? (
                          <span className="ok"> · {pctText(edge)} better than market, fills when the market gets there</span>
                        ) : (
                          <span className="bad"> · {pctText(-edge)} worse than market</span>
                        ))}
                    </>
                  )
                }
              />
              <div className="kv receive">
                <span>You receive if fully filled</span>
                <span className="gold num">
                  {receive !== null ? fmt(receive) : '0'} {buy}
                </span>
              </div>
              <div className="fieldset">
                <span>Expires in</span>
                <Segmented label="Expires in" full value={hours} options={DURATIONS} onChange={setHours} />
              </div>
              <button type="button" className="cta" disabled={!!account && !!problem} onClick={account ? submit : openConnect}>
                {!account ? 'Connect wallet' : (problem ?? 'Place limit order')}
              </button>
              <span className="hint">Fills when it is the best route for a trader. Partial fills allowed.</span>
            </>
          )}
        </section>

        <section className="card" aria-label="Your orders">
          <div className="card-head">
            <h2>Your orders</h2>
            {positions.value && <span className="chip accent">{openCount} open</span>}
          </div>
          {!account ? (
            <Empty
              title="No wallet connected"
              action={
                <button type="button" className="btn sm" onClick={openConnect}>
                  Connect wallet
                </button>
              }
            >
              Connect to see and manage your orders.
            </Empty>
          ) : !positions.value ? (
            positions.error ? (
              <p className="hint bad">Could not load orders: {positions.error}</p>
            ) : (
              <SkeletonRows />
            )
          ) : orders.length === 0 ? (
            <Empty title="No limit orders yet">Place one on the left. Your coins stay in your wallet until a trader fills it.</Empty>
          ) : (
            <ul className="list">
              {orders.map((o) => (
                <MarketRow key={o.s.id} {...o} now={now} actions={actions} order />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
