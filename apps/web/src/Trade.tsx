import { useCurrentAccount, useCurrentClient } from '@mysten/dapp-kit-react';
import { addressBalance, createTakerOrder, formatUnits, getAllowance, mintTestCoin, parseUnits, typesOf, type Quote } from '@suijin/sdk';
import { useEffect, useState } from 'react';
import { explorerTx, fetchQuotes, requestFill, usePoll, useRun } from './chain';

const t = typesOf();

type Snapshot = { takerUsd: bigint; takerJpy: bigint; makerJpy: bigint; makerUsd: bigint; allowanceSpent: bigint };
type Result = { orderDigest: string; fillDigest?: string; error?: string; before: Snapshot; after?: Snapshot; quote: Quote };

export function Trade() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const run = useRun();
  const me = account?.address ?? '';
  const [amount, setAmount] = useState('10');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const balances = usePoll(async () => {
    if (!me) return null;
    const [usd, jpy] = await Promise.all([addressBalance(client, me, t.quote), addressBalance(client, me, t.base)]);
    return { usd, jpy };
  }, [me, client]);

  async function snapshot(q: Quote): Promise<Snapshot> {
    const [takerUsd, takerJpy, makerJpy, makerUsd, allowance] = await Promise.all([
      addressBalance(client, me, t.quote),
      addressBalance(client, me, t.base),
      addressBalance(client, q.maker, t.base),
      addressBalance(client, q.maker, t.quote),
      getAllowance(q.makerAllowanceId),
    ]);
    return { takerUsd, takerJpy, makerJpy, makerUsd, allowanceSpent: allowance?.currentSpend ?? 0n };
  }

  async function getQuotes() {
    setStatus('Quoting…');
    setResult(null);
    try {
      setQuotes(await fetchQuotes(parseUnits(amount)));
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function swap(q: Quote) {
    try {
      const before = await snapshot(q);
      setStatus('1/2 Sign: exact-cap payment allowance + order (no funds move yet)…');
      const placed = await run(
        createTakerOrder({
          strategyId: q.strategyId,
          quoteIn: q.quoteIn,
          minBaseOut: q.minBaseOut,
          quotedBaseOut: q.baseOut,
          expiresAtMs: Date.now() + 5 * 60_000,
          recipient: me,
        }),
      );
      setStatus('2/2 Executor settles both sides in one PTB…');
      const fill = await requestFill(placed.created('::order::SwapOrder<'), placed.created('::allowance::Allowance<'));
      const after = fill.ok ? await snapshot(q) : undefined;
      setResult({ orderDigest: placed.digest, fillDigest: fill.digest, error: fill.error, before, after, quote: q });
      setStatus(fill.ok ? 'Filled' : `Fill failed: ${fill.error}`);
      balances.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  if (!me) return <p className="muted">Connect a wallet to trade.</p>;

  return (
    <div className="grid">
      <section className="card">
        <h2>Your balance</h2>
        <p className="big">{balances.value ? formatUnits(balances.value.usd) : '…'} tUSD</p>
        <p className="muted">{balances.value ? formatUnits(balances.value.jpy) : '…'} tJPY</p>
        <button onClick={() => run(mintTestCoin('tusd', 100_000_000n)).then(balances.refresh)}>Mint 100 test tUSD</button>
      </section>

      <section className="card">
        <h2>Swap tUSD → tJPY</h2>
        <label>
          You pay (tUSD)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button onClick={getQuotes}>Get quotes</button>
        {quotes.map((q, i) => {
          const secondsLeft = Math.max(0, Math.round((q.expiresAtMs - now) / 1000));
          return (
            <div key={q.strategyId} className="quote">
              <span>
                {i === 0 && <b>Best · </b>}
                {q.kind} strategy → <b>{formatUnits(q.baseOut)} tJPY</b> (min {formatUnits(q.minBaseOut)})
                <br />
                <span className="muted">
                  maker {q.maker.slice(0, 8)}… · {secondsLeft > 0 ? `expires in ${secondsLeft}s` : 'expired, quote again'}
                </span>
              </span>
              <button disabled={secondsLeft === 0} onClick={() => swap(q)}>Swap</button>
            </div>
          );
        })}
        {quotes.length === 0 && status === '' && <p className="muted">No quotes yet.</p>}
        {status && <p>{status}</p>}
      </section>

      {result && (
        <section className="card wide">
          <h2>Settlement inspector</h2>
          <div className="table-wrap"><table>
            <thead>
              <tr><th /><th>Before</th><th>After</th></tr>
            </thead>
            <tbody>
              {(
                [
                  ['Taker tUSD', 'takerUsd'],
                  ['Taker tJPY', 'takerJpy'],
                  ['Maker tJPY', 'makerJpy'],
                  ['Maker tUSD', 'makerUsd'],
                  ['Maker allowance spent', 'allowanceSpent'],
                ] as const
              ).map(([label, k]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td>{formatUnits(result.before[k])}</td>
                  <td>{result.after ? formatUnits(result.after[k]) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p>
            Order tx: <a href={explorerTx(result.orderDigest)} target="_blank" rel="noreferrer">{result.orderDigest}</a>
            <br />
            Fill tx (one PTB, two allowances):{' '}
            {result.fillDigest ? <a href={explorerTx(result.fillDigest)} target="_blank" rel="noreferrer">{result.fillDigest}</a> : result.error}
          </p>
        </section>
      )}
    </div>
  );
}
