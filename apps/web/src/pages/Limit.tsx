import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { convertAt, fixedPriceFor, revokeAllowance, setStrategyActive, type CoinKey } from '@suijin/sdk';
import { useEffect, useState } from 'react';
import { coin, keyOf, openConnect, useAction, useBalances, useNow, usePositions } from '../chain';
import { AmountPanel, CoinIcon, Empty, FlipArrows, Meter, Segmented, Skeleton, Tabs, fmtAmt, fmtPrice, parseAmount, parsePrice, priceText, toInput, until } from '../ui';
import { FlowPanel, PriceField, decimalsOf, orientKeys, pairFor, useMarketPrice, useProvideFlow } from './Earn';
import { StatusChip, marketsOf, strategyPrice, type Market } from './Portfolio';
import { BalanceHint, TradeTabs } from './trade';
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
  const now = useNow(15_000);
  const flow = useProvideFlow();
  const [sell, setSell] = useState<CoinKey>('tJPY');
  const [buy, setBuy] = useState<CoinKey>('tUSD');
  const [text, setText] = useState('');
  const [price, setPrice] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [turns, setTurns] = useState(0);

  // The price reads "1 unit = P priced" whichever side is sold.
  const { unit, priced } = orientKeys(sell, buy);
  const sellsPriced = sell === priced;
  const dec = decimalsOf(unit, priced);
  const market = useMarketPrice(unit, priced);
  // The order competes with this side of the market: a trader buying `priced` gets `pricedOut` per
  // unit, a trader buying `unit` pays `pricedIn` per unit.
  const ref = sellsPriced ? market.pricedOut : market.pricedIn;
  useEffect(() => {
    if (price !== null || market.loading) return;
    const start = ref ?? (unit === 'tUSD' && priced === 'tJPY' ? 150_000_000n : null);
    setPrice(start === null ? '' : priceText(start));
  }, [price, market.loading, ref, unit, priced]);

  const amount = parseAmount(text, coin(sell).decimals);
  const P = parsePrice(price ?? '');
  const balance = balances.value?.address[sell];
  const receive = amount !== null && P !== null && P > 0n ? convertAt({ ...dec, price: P, amount, from: sellsPriced ? 'priced' : 'unit' }) : null;
  // The seller's edge over the market: selling priced wants fewer priced per unit, selling unit wants more.
  const edge = P !== null && P > 0n && ref !== null ? (sellsPriced ? Number(ref) / Number(P) : Number(P) / Number(ref)) - 1 : null;
  const priceAt = (e: number) => ref !== null && setPrice(priceText(sellsPriced ? scale(ref, 1 / (1 + e)) : scale(ref, 1 + e)));
  const flip = () => {
    setSell(buy);
    setBuy(sell);
    setPrice(null);
    setTurns((t) => t + 1);
  };
  // Picking the token already on the other side swaps the two; a new pair re-reads the market.
  const pickSell = (k: CoinKey) => (k === buy ? flip() : (setSell(k), setPrice(null)));
  const pickBuy = (k: CoinKey) => (k === sell ? flip() : (setBuy(k), setPrice(null)));

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
          // Exactly the limit price, no spread: selling priced, 1 unit buys P; selling unit, P buys 1 unit.
          ...fixedPriceFor({ ...dec, sell: sellsPriced ? 'priced' : 'unit', price: P, feeBps: 0n }),
          maxBasePerFill: amount,
          virtualBaseLimit: amount,
          expiresAtMs: exp,
          pair: pairFor(sell, buy),
        },
      ],
      done: 'Limit order placed',
    });
  }

  return (
    <div className="page limit-page">
      <div className="center">
        <section className="card trade-card" aria-label="New limit order">
          <div className="card-head">
            <TradeTabs current="limit" />
            <span className="small muted">
              {market.loading ? <Skeleton w={110} h={12} /> : ref !== null ? `Market ${fmtPrice(ref)} ${priced}` : 'No market yet'}
            </span>
          </div>
          {flow.stage !== 'idle' ? (
            <FlowPanel
              flow={flow}
              grant={{ title: 'Approve budget', detail: `Capped at ${amount ? fmtAmt(amount, sell) : '0'} ${sell}. Nothing moves.` }}
              open={{ title: 'Place order', detail: `Sell at 1 ${unit} = ${price ?? '—'} ${priced}.` }}
              success={{
                title: 'Limit order placed',
                body: `It fills when it is the best route for a trader. You receive up to ${receive !== null ? fmtAmt(receive, buy) : '0'} ${buy}.`,
              }}
              again="Place another"
            />
          ) : (
            <>
              <div className="pair">
                <AmountPanel
                  label="Sell"
                  coin={sell}
                  value={text}
                  onChange={setText}
                  onPick={pickSell}
                  exclude={buy}
                  balances={balances.value?.address}
                  balance={account ? (balance ?? null) : undefined}
                  onMax={balance !== undefined ? () => setText(toInput(balance, coin(sell).decimals)) : undefined}
                  invalid={text !== '' && (amount === null || amount <= 0n)}
                  autoFocus
                />
                <div className="flip-wrap">
                  <button type="button" className={`flip${turns % 2 ? ' turned' : ''}`} onClick={flip} aria-label="Switch coins">
                    <FlipArrows />
                  </button>
                </div>
                <AmountPanel
                  label="Receive if fully filled"
                  coin={buy}
                  value={receive !== null ? fmtAmt(receive, buy) : ''}
                  onPick={pickBuy}
                  exclude={sell}
                  balances={balances.value?.address}
                  outline
                />
              </div>
              {amount !== null && balance !== undefined && amount > balance && (
                <span className="hint warn">
                  Your wallet holds {fmtAmt(balance, sell)} {sell}: the order fills up to that.
                </span>
              )}
              <PriceField
                label="Limit price"
                unit={unit}
                priced={priced}
                value={price}
                onChange={setPrice}
                invalid={price !== null && price !== '' && (P === null || P <= 0n)}
                chips={
                  ref !== null && (
                    <span className="inline" style={{ gap: 6 }}>
                      {QUICK.map((q) => (
                        <button key={q.label} type="button" className="chip-btn" onClick={() => priceAt(q.edge)}>
                          {q.label}
                        </button>
                      ))}
                    </span>
                  )
                }
                hint={
                  ref === null || edge === null ? undefined : Math.abs(edge) < 0.0005 ? (
                    'At the market price'
                  ) : edge > 0 ? (
                    <span className="ok">{pctText(edge)} above market for you. It fills once the market reaches it.</span>
                  ) : (
                    <span className="bad">{pctText(-edge)} below market: traders get a better deal than the market.</span>
                  )
                }
              />
              <div className="fieldset">
                <span>Expires in</span>
                <Segmented label="Expires in" full value={hours} options={DURATIONS} onChange={setHours} />
              </div>
              <button type="button" className="cta" disabled={!!account && !!problem} onClick={account ? submit : openConnect}>
                {!account ? 'Connect wallet' : (problem ?? 'Place limit order')}
              </button>
              <BalanceHint coin={sell} balances={balances.value} me={account?.address ?? ''} />
            </>
          )}
        </section>
        <p className="note">Your coins stay in your wallet until a trader fills the order. Partial fills are allowed.</p>
      </div>
      <Orders account={!!account} positions={positions} now={now} />
    </div>
  );
}

type Tab = 'open' | 'history';

function Orders({ account, positions, now }: { account: boolean; positions: ReturnType<typeof usePositions>; now: number }) {
  const actions = useAction();
  const [tab, setTab] = useState<Tab>('open');
  const orders = positions.value ? marketsOf(positions.value.strategies.filter((s) => s.kind === 'fixed'), positions.value.budgets, now) : [];
  const live = orders.filter((o) => o.status === 'open' || o.status === 'paused');
  const past = orders.filter((o) => o.status !== 'open' && o.status !== 'paused');
  const shown = tab === 'open' ? live : past;
  return (
    <section className="card orders" aria-label="Your orders">
      <div className="card-head">
        <Tabs
          label="Orders"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'open', label: 'Open orders', count: positions.value ? live.length : undefined },
            { value: 'history', label: 'History', count: positions.value ? past.length : undefined },
          ]}
        />
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
      ) : positions.error && !positions.value ? (
        <p className="hint bad">Could not load orders: {positions.error}</p>
      ) : positions.value && shown.length === 0 ? (
        <Empty title={tab === 'open' ? 'No open orders' : 'No past orders'}>
          {tab === 'open' ? 'Orders you place show up here while they wait for a trader.' : 'Filled, expired and cancelled orders show up here.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Order</th>
                <th>Price</th>
                <th>Filled</th>
                <th className="r">Received</th>
                <th>Status</th>
                <th className="r" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {!positions.value
                ? [0, 1].map((i) => (
                    <tr key={i}>
                      {[140, 80, 110, 70, 60, 60].map((w, j) => (
                        <td key={j}>
                          <Skeleton w={w} h={14} />
                        </td>
                      ))}
                    </tr>
                  ))
                : shown.map((o) => <OrderRow key={o.s.id} o={o} now={now} actions={actions} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OrderRow({ o, now, actions }: { o: Market; now: number; actions: ReturnType<typeof useAction> }) {
  const { s, budget, status } = o;
  const base = keyOf(s.baseType);
  const quote = keyOf(s.quoteType);
  const total = s.baseFilled + s.virtualBaseRemaining;
  const filled = total > 0n ? Number((s.baseFilled * 1000n) / total) / 1000 : 0;
  const live = status === 'open' || status === 'paused';
  const { act, busy } = actions;
  const toggleKey = `toggle:${s.id}`;
  const cancelKey = `cancel:${s.id}`;
  // Cancel = revoke the order's own budget. A budget that also backs other markets is paused instead.
  const own = budget && budget.markets.length === 1 ? budget : null;
  const px = strategyPrice(s);
  return (
    <tr>
      <td>
        <span className="cell">
          <CoinIcon coin={base} size={26} />
          <span>
            <b>
              Sell {fmtAmt(total, base)} {base}
            </b>
            <span className="sub">for {quote}</span>
          </span>
        </span>
      </td>
      <td>
        {fmtPrice(px.price)}
        <span className="sub">
          {px.priced} per {px.unit}
        </span>
      </td>
      <td>
        <div style={{ width: 96 }}>
          <Meter value={filled} label={`${Math.round(filled * 100)}% filled`} />
        </div>
        <span className="sub">{Math.round(filled * 100)}%</span>
      </td>
      <td className="r">
        <span className="gold">{fmtAmt(s.quoteReceived, quote)}</span> {quote}
      </td>
      <td>
        <StatusChip status={status} order />
        {live && <span className="sub">ends in {until(s.expiryMs, now)}</span>}
      </td>
      <td className="r">
        {live && (
          <>
            <button
              type="button"
              className="act"
              disabled={!!busy}
              onClick={() =>
                act(status === 'open' ? 'Pausing order' : 'Resuming order', () => setStrategyActive(s.id, status !== 'open', { base: s.baseType, quote: s.quoteType }), {
                  done: status === 'open' ? 'Order paused' : 'Order live again',
                  key: toggleKey,
                })
              }
            >
              {busy === toggleKey ? '…' : status === 'open' ? 'Pause' : 'Resume'}
            </button>
            {own && (
              <button
                type="button"
                className="act danger"
                disabled={!!busy}
                onClick={() =>
                  act('Cancelling order', () => revokeAllowance({ coin: coin(own.coin).type, allowanceId: own.allowance.id, capId: own.capId }), {
                    done: 'Order cancelled',
                    key: cancelKey,
                  })
                }
              >
                {busy === cancelKey ? '…' : 'Cancel'}
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}
