import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { isValidSuiAddress } from '@mysten/sui/utils';
import { fetchCoinInfo, sameType, tokensOf, type CoinKey } from '@suijin/sdk';
import { useEffect, useState } from 'react';
import { addToken, coin as tokenInfo, openConnect, toast, tokens, useBalances, useQuotes } from '../chain';
import { AmountPanel, TokenPicker, cleanAmount, fmtAmt, fmtCoin, parseAmount, short, toInput } from '../ui';
import { BalanceHint, FlowProgress, QuoteDetails, Receipt, RefreshRing, SlippageSettings, Sliders, TradeTabs, settledLine, useOrderFlow } from './trade';

const REFRESH_MS = 15_000;

/** Payment request links: '#/pay?to=0x…&amount=1500&coin=tJPY'. `coin` is a listed symbol or a full coin type. */
function requestParams() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const param = q.get('coin') ?? 'tJPY';
  const known = tokens().find((t) => t.key === param || sameType(t.type, param));
  return { to: q.get('to') ?? '', amount: q.get('amount') ?? '', coin: known?.key ?? 'tJPY', unknownType: known ? null : param };
}

/** A link's coin this browser has not listed yet: looks it up by type and adds it. */
function useLinkedToken(type: string | null, onFound: (key: CoinKey) => void) {
  useEffect(() => {
    if (!type || !type.includes('::')) return;
    fetchCoinInfo(type).then((info) => info && onFound(addToken(info).key), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
}

/** What goes in a link: the symbol for built-in tokens, the full type for ones added by hand. */
const linkCoin = (key: CoinKey) => (tokensOf().some((t) => t.key === key) ? key : tokenInfo(key).type);

export function Pay() {
  const me = useCurrentAccount()?.address ?? '';
  const balances = useBalances();
  const flow = useOrderFlow();
  const [request] = useState(requestParams);
  const [to, setTo] = useState(request.to);
  const [text, setText] = useState(request.amount);
  const [coin, setCoin] = useState<CoinKey>(request.coin);
  const [payWith, setPayWith] = useState<CoinKey>(request.coin === 'tUSD' ? 'tJPY' : 'tUSD');
  useLinkedToken(request.unknownType, setCoin);
  const pickCoin = (k: CoinKey) => {
    if (k === payWith) setPayWith(coin);
    setCoin(k);
    setPicked(null);
  };
  const pickPayWith = (k: CoinKey) => {
    if (k === coin) setCoin(payWith);
    setPayWith(k);
    setPicked(null);
  };
  const [slippageBps, setSlippageBps] = useState(50);
  const [settings, setSettings] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const recipient = to.trim().toLowerCase();
  const validTo = isValidSuiAddress(recipient) && recipient.length === 66;
  const amount = parseAmount(text, tokenInfo(coin).decimals);
  const idle = flow.step === 'idle';
  const live = useQuotes(idle && amount ? { sell: payWith, buy: coin, amountOut: amount, slippageBps } : null, REFRESH_MS);
  const quote = idle ? (live.quotes.find((q) => q.strategyId === picked) ?? live.best) : (flow.quote ?? null);
  const balance = balances.value?.address[payWith] ?? null;
  const tooMuch = !!me && !!quote && balance !== null && quote.quoteIn > balance;

  const cta = (() => {
    if (!me) return { label: 'Connect wallet', onClick: openConnect };
    if (!validTo) return { label: 'Enter who to pay' };
    if (!amount) return { label: 'Enter an amount' };
    if (live.loading) return { label: 'Finding the best price…' };
    if (live.error) return { label: 'Quotes unavailable', warn: true };
    if (!quote) return { label: 'Not enough liquidity for this amount', warn: true };
    if (tooMuch) return { label: `Not enough ${payWith}`, warn: true };
    if (balances.value?.gas === 0n) return { label: 'Need testnet SUI for gas', warn: true };
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
          {parseAmount(request.amount, tokenInfo(coin).decimals) && (
            <>
              {' '}
              for <b>{fmtCoin(parseAmount(request.amount, tokenInfo(coin).decimals)!, coin)}</b>
            </>
          )}
        </p>
      )}
      <section className="card trade-card" aria-busy={live.loading}>
        <div className="card-head">
          <TradeTabs current="pay" />
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
            onPick={idle ? pickCoin : undefined}
            balances={balances.value?.address}
          />
          <AmountPanel
            label="You pay"
            coin={payWith}
            outline
            value={quote ? fmtAmt(quote.quoteIn, payWith) : ''}
            onPick={idle ? pickPayWith : undefined}
            exclude={coin}
            balances={balances.value?.address}
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
            <BalanceHint coin={payWith} balances={balances.value} me={me} />
          </>
        ) : (
          <FlowProgress flow={flow} payLabel={quote ? `${toInput(quote.quoteIn, tokenInfo(payWith).decimals)} ${payWith}` : payWith} />
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
  const { decimals } = tokenInfo(coin);
  const amount = parseAmount(text, decimals);
  const link = `${location.origin}${location.pathname}#/pay?to=${me}&coin=${encodeURIComponent(linkCoin(coin))}${amount ? `&amount=${toInput(amount, decimals)}` : ''}`;
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
        <TokenPicker label="Currency to receive" value={coin} onPick={setCoin} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The payer can hold any token with a market into {coin}. They pay in theirs, you receive {coin}.
      </p>
      <div className="inline" style={{ flexWrap: 'nowrap' }}>
        <input
          className="input"
          inputMode="decimal"
          placeholder={`Amount in ${coin} (optional)`}
          aria-label={`Amount in ${coin}`}
          value={text}
          onChange={(e) => setText(cleanAmount(e.target.value, decimals))}
        />
        <button type="button" className="btn" onClick={copy} style={{ whiteSpace: 'nowrap' }}>
          Copy link
        </button>
      </div>
    </section>
  );
}
