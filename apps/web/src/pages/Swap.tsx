import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { mintTestCoins, type CoinKey } from '@suijin/sdk';
import { useState } from 'react';
import { openConnect, other, useAction, useBalances, useQuotes } from '../chain';
import { AmountPanel, FlipArrows, fmt, parseAmount, toInput } from '../ui';
import { FlowProgress, QuoteDetails, RateLine, Receipt, RefreshRing, SlippageSettings, Sliders, settledLine, useOrderFlow } from './trade';

const REFRESH_MS = 15_000;

export function Swap() {
  const me = useCurrentAccount()?.address ?? '';
  const balances = useBalances();
  const flow = useOrderFlow();
  const faucet = useAction();
  const [sell, setSell] = useState<CoinKey>('tUSD');
  const buy = other(sell);
  // The amount stays with the field the trader typed in: exact input or exact output.
  const [side, setSide] = useState<'in' | 'out'>('in');
  const [text, setText] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [settings, setSettings] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [turns, setTurns] = useState(0);

  const amount = parseAmount(text);
  const idle = flow.step === 'idle';
  const live = useQuotes(
    idle && amount ? { sell, buy, slippageBps, ...(side === 'in' ? { amountIn: amount } : { amountOut: amount }) } : null,
    REFRESH_MS,
  );
  const quote = idle ? (live.quotes.find((q) => q.strategyId === picked) ?? live.best) : (flow.quote ?? null);

  const pay = side === 'in' ? amount : (quote?.quoteIn ?? null);
  const balance = balances.value?.[sell] ?? null;
  const tooMuch = !!me && balance !== null && pay !== null && pay > balance;

  const type = (s: 'in' | 'out') => (v: string) => {
    setSide(s);
    setText(v);
    setPicked(null);
  };
  const flip = () => {
    setSell(buy);
    setSide(side === 'in' ? 'out' : 'in'); // the typed amount follows its coin
    setPicked(null);
    setTurns((t) => t + 1);
  };

  const cta = (() => {
    if (!me) return { label: 'Connect wallet', onClick: openConnect };
    if (!amount) return { label: 'Enter an amount' };
    if (side === 'in' && tooMuch) return { label: `Not enough ${sell}`, warn: true };
    if (live.loading) return { label: 'Finding the best price…' };
    if (live.error) return { label: 'Quotes unavailable', warn: true };
    if (!quote) return { label: 'Not enough liquidity for this size', warn: true };
    if (tooMuch) return { label: `Not enough ${sell}`, warn: true };
    if (balances.value?.sui === 0n) return { label: 'Need testnet SUI for gas', warn: true };
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
          <h1 className="mode">Swap</h1>
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
            value={side === 'in' ? text : quote ? fmt(quote.quoteIn) : ''}
            onChange={idle ? type('in') : undefined}
            onCoin={idle ? flip : undefined}
            balance={me ? balance : undefined}
            onMax={idle && balance ? () => type('in')(toInput(balance)) : undefined}
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
            value={side === 'out' ? text : quote ? fmt(quote.baseOut) : ''}
            onChange={idle ? type('out') : undefined}
            onCoin={idle ? flip : undefined}
            balance={me ? (balances.value?.[buy] ?? null) : undefined}
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
            <button type="button" className={`cta${cta.warn ? ' warn' : ''}`} disabled={!cta.onClick} onClick={cta.onClick}>
              {cta.label}
            </button>
            {me && balance === 0n && (
              <button
                type="button"
                className="link-btn"
                style={{ alignSelf: 'center' }}
                disabled={!!faucet.busy}
                onClick={() => faucet.act('Minting test tokens', () => mintTestCoins({ tusd: 1_000_000_000n, tjpy: 150_000_000_000n }), { done: 'Added 1,000 tUSD and 150,000 tJPY' })}
              >
                {faucet.busy ? 'Minting…' : `No ${sell} yet? Get test tokens`}
              </button>
            )}
          </>
        ) : (
          <FlowProgress flow={flow} payLabel={quote ? `${toInput(quote.quoteIn)} ${sell}` : sell} />
        )}
      </section>

      <p className="note">
        Settles in one transaction through Sui allowances. Providers quote from their own wallets, so nothing sits in a pool.
      </p>
    </div>
  );
}
