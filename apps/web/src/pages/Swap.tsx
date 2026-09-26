import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { type CoinKey } from '@suijin/sdk';
import { useState } from 'react';
import { coin, openConnect, useBalances, useQuotes } from '../chain';
import { AmountPanel, FlipArrows, fmtAmt, parseAmount, pct, toInput } from '../ui';
import { BalanceHint, FlowProgress, QuoteDetails, RateLine, Receipt, RefreshRing, SlippageSettings, Sliders, TradeTabs, settledLine, useOrderFlow } from './trade';

const REFRESH_MS = 15_000;

export function Swap() {
  const me = useCurrentAccount()?.address ?? '';
  const balances = useBalances();
  const flow = useOrderFlow();
  const [sell, setSell] = useState<CoinKey>('tUSD');
  const [buy, setBuy] = useState<CoinKey>('tJPY');
  // The amount stays with the field the trader typed in: exact input or exact output.
  const [side, setSide] = useState<'in' | 'out'>('in');
  const [text, setText] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [settings, setSettings] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [turns, setTurns] = useState(0);

  // The typed amount belongs to the side it was typed in, so it parses with that token's decimals.
  const amount = parseAmount(text, coin(side === 'in' ? sell : buy).decimals);
  const idle = flow.step === 'idle';
  const live = useQuotes(
    idle && amount ? { sell, buy, slippageBps, ...(side === 'in' ? { amountIn: amount } : { amountOut: amount }) } : null,
    REFRESH_MS,
  );
  const quote = idle ? (live.quotes.find((q) => q.strategyId === picked) ?? live.best) : (flow.quote ?? null);

  const pay = side === 'in' ? amount : (quote?.quoteIn ?? null);
  const balance = balances.value?.address[sell] ?? null;
  const tooMuch = !!me && balance !== null && pay !== null && pay > balance;

  const type = (s: 'in' | 'out') => (v: string) => {
    setSide(s);
    setText(v);
    setPicked(null);
  };
  const flip = () => {
    setSell(buy);
    setBuy(sell);
    setSide(side === 'in' ? 'out' : 'in'); // the typed amount follows its coin
    setPicked(null);
    setTurns((t) => t + 1);
  };
  // Picking the token already on the other side swaps the two.
  const pickSell = (k: CoinKey) => (k === buy ? flip() : (setSell(k), setPicked(null)));
  const pickBuy = (k: CoinKey) => (k === sell ? flip() : (setBuy(k), setPicked(null)));

  const cta = (() => {
    if (!me) return { label: 'Connect wallet', onClick: openConnect };
    if (!amount) return { label: 'Enter an amount' };
    if (side === 'in' && tooMuch) return { label: `Not enough ${sell}`, warn: true };
    if (live.loading) return { label: 'Finding the best price…' };
    if (live.error) return { label: 'Quotes unavailable', warn: true };
    if (!quote) return { label: 'Not enough liquidity for this size', warn: true };
    if (tooMuch) return { label: `Not enough ${sell}`, warn: true };
    if (balances.value?.gas === 0n) return { label: 'Need testnet SUI for gas', warn: true };
    // Above 5% impact the route is a thin curve: still allowed, but the trader must mean it.
    if (quote.impactBps >= 500) return { label: `Swap anyway (${pct(quote.impactBps)} price impact)`, risky: true, onClick: () => flow.execute(quote, me) };
    return { label: 'Swap', onClick: () => flow.execute(quote, me) };
  })();

  if (flow.step === 'done') {
    return (
      <div className="center page">
        <section className="card">
          <Receipt flow={flow} title="Swap settled" again="New swap">
            {settledLine(flow)}
            <p className="small muted">Paid from your wallet balance. Received straight into it.</p>
          </Receipt>
        </section>
      </div>
    );
  }

  return (
    <div className="center page">
      <section className="card trade-card" aria-busy={live.loading}>
        <div className="card-head">
          <TradeTabs current="swap" />
          <div className="inline">
            {quote && idle && <RefreshRing updatedAt={live.updatedAt} ms={REFRESH_MS} onClick={live.refresh} />}
            <button
              type="button"
              className="icon-btn"
              aria-expanded={settings}
              aria-label="Swap settings"
              onClick={() => setSettings((v) => !v)}
            >
              <Sliders />
            </button>
          </div>
        </div>
        {settings && (
          <SlippageSettings
            value={slippageBps}
            onChange={setSlippageBps}
            note={side === 'in' ? 'Your order fails instead of filling below this.' : 'Extra input so the exact output still arrives if the price moves.'}
          />
        )}

        <div className={`pair${idle ? '' : ' locked'}`}>
          <AmountPanel
            label="Sell"
            coin={sell}
            value={side === 'in' ? text : quote ? fmtAmt(quote.quoteIn, sell) : ''}
            onChange={idle ? type('in') : undefined}
            onPick={idle ? pickSell : undefined}
            exclude={buy}
            balances={balances.value?.address}
            balance={me ? balance : undefined}
            onMax={idle && balance ? () => type('in')(toInput(balance, coin(sell).decimals)) : undefined}
            loading={side === 'out' && live.loading}
            invalid={tooMuch}
            autoFocus
          />
          <div className="flip-wrap">
            <button type="button" className={`flip${turns % 2 ? ' turned' : ''}`} onClick={flip} disabled={!idle} aria-label="Switch direction">
              <FlipArrows />
            </button>
          </div>
          <AmountPanel
            label="Buy"
            coin={buy}
            outline
            value={side === 'out' ? text : quote ? fmtAmt(quote.baseOut, buy) : ''}
            onChange={idle ? type('out') : undefined}
            onPick={idle ? pickBuy : undefined}
            exclude={sell}
            balances={balances.value?.address}
            balance={me ? (balances.value?.address[buy] ?? null) : undefined}
            loading={side === 'in' && live.loading}
          />
        </div>

        {amount && (
          <div className="spread small">
            <RateLine quote={quote} sell={sell} buy={buy} loading={live.loading} />
          </div>
        )}

        {idle ? (
          <>
            {quote && (
              <QuoteDetails
                quote={quote}
                quotes={live.quotes}
                onPick={setPicked}
                sell={sell}
                buy={buy}
                slippageBps={slippageBps}
                exactOut={side === 'out'}
                receiver="You"
              />
            )}
            {live.error && <p className="hint bad">{live.error}</p>}
            <button type="button" className={`cta${cta.warn ? ' warn' : ''}${cta.risky ? ' risky' : ''}`} disabled={!cta.onClick} onClick={cta.onClick}>
              {cta.label}
            </button>
            <BalanceHint coin={sell} balances={balances.value} me={me} />
          </>
        ) : (
          <FlowProgress flow={flow} payLabel={quote ? `${toInput(quote.quoteIn, coin(sell).decimals)} ${sell}` : sell} />
        )}
      </section>

      <p className="note">
        Settles in one transaction through Sui allowances. Providers quote from their own wallets, so nothing sits in a pool.
      </p>
    </div>
  );
}
