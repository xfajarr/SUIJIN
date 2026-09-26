import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { isValidSuiAddress } from '@mysten/sui/utils';
import type { CoinKey } from '@suijin/sdk';
import { useState } from 'react';
import { COIN_KEYS, openConnect, other, toast, useBalances, useQuotes } from '../chain';
import { AmountPanel, CoinIcon, Segmented, cleanAmount, fmt, fmtCoin, parseAmount, short, toInput } from '../ui';
import { FlowProgress, QuoteDetails, Receipt, RefreshRing, SlippageSettings, Sliders, settledLine, useOrderFlow } from './trade';

const REFRESH_MS = 15_000;

/** Payment request links: '#/pay?to=0x…&amount=1500&coin=tJPY'. */
function requestParams() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const coin = q.get('coin');
  return {
    to: q.get('to') ?? '',
    amount: cleanAmount(q.get('amount') ?? ''),
    coin: (COIN_KEYS as string[]).includes(coin ?? '') ? (coin as CoinKey) : 'tJPY',
  };
}

export function Pay() {
  const me = useCurrentAccount()?.address ?? '';
  const balances = useBalances();
  const flow = useOrderFlow();
  const [request] = useState(requestParams);
  const [to, setTo] = useState(request.to);
  const [text, setText] = useState(request.amount);
  const [coin, setCoin] = useState<CoinKey>(request.coin);
  const payWith = other(coin);
  const [slippageBps, setSlippageBps] = useState(50);
  const [settings, setSettings] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const recipient = to.trim().toLowerCase();
  const validTo = isValidSuiAddress(recipient) && recipient.length === 66;
  const amount = parseAmount(text);
  const idle = flow.step === 'idle';
  const live = useQuotes(idle && amount ? { sell: payWith, buy: coin, amountOut: amount, slippageBps } : null, REFRESH_MS);
  const quote = idle ? (live.quotes.find((q) => q.strategyId === picked) ?? live.best) : (flow.quote ?? null);
  const balance = balances.value?.[payWith] ?? null;
  const tooMuch = !!me && !!quote && balance !== null && quote.quoteIn > balance;

  const cta = (() => {
    if (!me) return { label: 'Connect wallet', onClick: openConnect };
    if (!validTo) return { label: 'Enter who to pay' };
    if (!amount) return { label: 'Enter an amount' };
    if (live.loading) return { label: 'Finding the best price…' };
    if (live.error) return { label: 'Quotes unavailable', warn: true };
    if (!quote) return { label: 'Not enough liquidity for this amount', warn: true };
    if (tooMuch) return { label: `Not enough ${payWith}`, warn: true };
    if (balances.value?.sui === 0n) return { label: 'Need testnet SUI for gas', warn: true };
    return { label: `Pay ${fmtCoin(amount, coin)}`, onClick: () => flow.execute(quote, recipient) };
  })();

  if (flow.step === 'done') {
    return (
      <div className="center page">
        <section className="card">
          <Receipt flow={flow} title={`Paid ${short(flow.recipient ?? '')}`} again="New payment">
            {settledLine(flow)}
            <p className="small muted">
              They received at least {fmtCoin(flow.quote!.minBaseOut, coin)}. Conversion and delivery settled in one transaction.
            </p>
          </Receipt>
        </section>
      </div>
    );
  }

  return (
    <div className="center page">
      {request.to && idle && (
        <p className="banner" role="note">
          Payment request from <span className="mono">{short(request.to)}</span>
          {parseAmount(request.amount) && (
            <>
              {' '}
              for <b>{fmtCoin(parseAmount(request.amount)!, request.coin)}</b>
            </>
          )}
        </p>
      )}
      <section className="card" aria-busy={live.loading}>
        <div className="card-head">
          <h1 className="card-title">Pay</h1>
          <div className="inline">
            {quote && idle && <RefreshRing updatedAt={live.updatedAt} ms={REFRESH_MS} onClick={live.refresh} />}
            <button type="button" className="icon-btn" aria-expanded={settings} aria-label="Payment settings" onClick={() => setSettings((v) => !v)}>
              <Sliders />
            </button>
          </div>
        </div>
        {settings && (
          <SlippageSettings value={slippageBps} onChange={setSlippageBps} note="Extra input so the exact amount still arrives if the price moves. Any surplus goes to the recipient." />
        )}

        <label className="field">
          Pay to
          <input
            className={`input mono${to && !validTo ? ' invalid' : ''}`}
            placeholder="0x… Sui address"
            value={to}
            spellCheck={false}
            autoComplete="off"
            readOnly={!idle}
            onChange={(e) => setTo(e.target.value)}
            aria-invalid={(!!to && !validTo) || undefined}
          />
          {to && !validTo && <span className="hint bad">Enter a full Sui address: 0x and 64 hex characters.</span>}
          {validTo && recipient === me.toLowerCase() && <span className="hint">That is your own wallet.</span>}
        </label>

        <div className={`pair${idle ? '' : ' locked'}`}>
          <AmountPanel
            label="They receive exactly"
            coin={coin}
            value={text}
            onChange={
              idle
                ? (v) => {
                    setText(v);
                    setPicked(null);
                  }
                : undefined
            }
            onCoin={idle ? () => setCoin(payWith) : undefined}
          />
          <AmountPanel
            label="You pay"
            coin={payWith}
            value={quote ? fmt(quote.quoteIn) : ''}
            balance={me ? balance : undefined}
            loading={live.loading}
            invalid={tooMuch}
            footer={quote && <span>Converted from your {payWith} at settlement</span>}
          />
        </div>

        {idle ? (
          <>
            {quote && (
              <QuoteDetails
                quote={quote}
                quotes={live.quotes}
                onPick={setPicked}
                sell={payWith}
                buy={coin}
                slippageBps={slippageBps}
                exactOut
                receiver="They"
              />
            )}
            {live.error && <p className="hint bad">{live.error}</p>}
            <button type="button" className={`cta${cta.warn ? ' warn' : ''}`} disabled={!cta.onClick} onClick={cta.onClick}>
              {cta.label}
            </button>
          </>
        ) : (
          <FlowProgress flow={flow} payLabel={quote ? `${toInput(quote.quoteIn)} ${payWith}` : payWith} />
        )}
      </section>

      {me && idle && <RequestLink me={me} />}
    </div>
  );
}

/** Get paid: a link that opens Pay with this wallet, amount and coin filled in. */
function RequestLink({ me }: { me: string }) {
  const [text, setText] = useState('');
  const [coin, setCoin] = useState<CoinKey>('tJPY');
  const amount = parseAmount(text);
  const link = `${location.origin}${location.pathname}#/pay?to=${me}&coin=${coin}${amount ? `&amount=${toInput(amount)}` : ''}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.push({ kind: 'success', title: 'Payment link copied', body: amount ? `${fmtCoin(amount, coin)} to ${short(me)}` : `Any amount of ${coin} to ${short(me)}` });
    } catch {
      toast.push({ kind: 'error', title: 'Could not copy', body: link });
    }
  };
  return (
    <section className="card request">
      <div className="card-head">
        <h2>Request a payment</h2>
        <Segmented
          label="Currency to receive"
          value={coin}
          onChange={setCoin}
          options={COIN_KEYS.map((c) => ({
            value: c,
            label: (
              <span className="inline" style={{ gap: 6 }}>
                <CoinIcon coin={c} size={16} />
                {c}
              </span>
            ),
          }))}
        />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The payer can hold either coin. They pay in theirs, you receive {coin}.
      </p>
      <div className="inline" style={{ flexWrap: 'nowrap' }}>
        <input
          className="input"
          inputMode="decimal"
          placeholder={`Amount in ${coin} (optional)`}
          aria-label={`Amount in ${coin}`}
          value={text}
          onChange={(e) => setText(cleanAmount(e.target.value))}
        />
        <button type="button" className="btn" onClick={copy} style={{ whiteSpace: 'nowrap' }}>
          Copy link
        </button>
      </div>
    </section>
  );
}
