import { useCurrentAccount, useCurrentClient } from '@mysten/dapp-kit-react';
import {
  addressBalance,
  allowanceRemaining,
  createCurveStrategy,
  createFixedStrategy,
  formatUnits,
  getAllowance,
  issueMakerAllowance,
  listAllowanceCaps,
  listStrategies,
  mintTestCoin,
  parseUnits,
  revokeAllowance,
  setStrategyActive,
  sharedLiquidityRatio,
  typesOf,
} from '@suijin/sdk';
import { useState } from 'react';
import { explorerTx, usePoll, useRun } from './chain';

const HOUR = 3_600_000;
const t = typesOf();

export function Maker() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const run = useRun();
  const me = account?.address ?? '';
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [cap, setCap] = useState('1000000');
  const [price, setPrice] = useState('150');
  const [feeBps, setFeeBps] = useState('30');

  const state = usePoll(async () => {
    if (!me) return null;
    const [jpy, usd, caps, strategies] = await Promise.all([
      addressBalance(client, me, t.base),
      addressBalance(client, me, t.quote),
      listAllowanceCaps(me, t.base),
      listStrategies(),
    ]);
    const current = caps.at(-1) ?? null;
    const allowance = current ? await getAllowance(current.allowanceId) : null;
    const mine = strategies.filter((s) => s.maker === me && s.makerAllowanceId === current?.allowanceId);
    return { jpy, usd, current, allowance, mine };
  }, [me, client]);

  const s = state.value;
  const remaining = s?.allowance ? allowanceRemaining(s.allowance) : null;
  const executable = s ? (remaining !== null && remaining < s.jpy ? remaining : s.jpy) : 0n;

  async function act(label: string, build: () => Parameters<typeof run>[0]) {
    setBusy(label);
    try {
      const r = await run(build());
      setLog((l) => [`${label}: ${r.digest}`, ...l]);
      state.refresh();
      return r;
    } catch (e) {
      setLog((l) => [`${label} failed: ${e instanceof Error ? e.message : e}`, ...l]);
    } finally {
      setBusy('');
    }
  }

  if (!me) return <p className="muted">Connect a wallet to act as the maker.</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const allowanceId = s.current?.allowanceId ?? '';

  return (
    <div className="grid">
      <section className="card">
        <h2>Inventory</h2>
        <p className="big">{formatUnits(s.jpy)} tJPY</p>
        <p className="muted">{formatUnits(s.usd)} tUSD received from trades · address balance, never deposited</p>
        <button disabled={!!busy} onClick={() => act('mint 1,000,000 tJPY', () => mintTestCoin('tjpy', 1_000_000_000_000n))}>
          Mint 1,000,000 test tJPY
        </button>
      </section>

      <section className="card">
        <h2>Allowance</h2>
        {s.allowance ? (
          <>
            <dl>
              <dt>Cap</dt><dd>{formatUnits(s.allowance.lifetimeCap ?? 0n)} tJPY</dd>
              <dt>Spent</dt><dd>{formatUnits(s.allowance.currentSpend)} tJPY</dd>
              <dt>Remaining</dt><dd>{remaining === null ? 'rate-limited' : `${formatUnits(remaining)} tJPY`}</dd>
              <dt>Spender</dt><dd className="mono">{s.allowance.spender?.slice(0, 10)}… (executor)</dd>
              <dt>Expires</dt><dd>{s.allowance.expirationMs ? new Date(Number(s.allowance.expirationMs)).toLocaleString() : '—'}</dd>
            </dl>
            <button
              className="danger"
              disabled={!!busy}
              onClick={() => act('revoke', () => revokeAllowance({ coin: t.base, allowanceId, capId: s.current!.capId }))}
            >
              Revoke allowance
            </button>
          </>
        ) : (
          <>
            <label>
              Cap (tJPY)
              <input value={cap} onChange={(e) => setCap(e.target.value)} />
            </label>
            <button
              disabled={!!busy}
              onClick={() => act('issue allowance', () => issueMakerAllowance({ cap: parseUnits(cap), expiresAtMs: Date.now() + 12 * HOUR }))}
            >
              Grant app-bound allowance (12 h)
            </button>
            <p className="muted">Bounded permission for the executor, enforced by suijin's Move rules. No funds move.</p>
          </>
        )}
      </section>

      <section className="card wide">
        <h2>Strategies on this allowance</h2>
        <p>
          Shared liquidity ratio <b>{sharedLiquidityRatio(s.mine, executable).toFixed(2)}×</b>
          <span className="muted"> · advertised availability over real executable inventory ({formatUnits(executable)} tJPY). Not TVL, not leverage.</span>
        </p>
        <div className="table-wrap"><table>
          <thead>
            <tr><th>Kind</th><th>Price</th><th>Advertised</th><th>Fills</th><th>Sold</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {s.mine.map((x) => (
              <tr key={x.id}>
                <td>{x.kind}</td>
                <td>{x.kind === 'fixed' ? `1 tUSD = ${formatUnits(x.priceDen * 1_000_000n / x.priceNum)} tJPY` : `curve, ${x.feeBps} bps`}</td>
                <td>{formatUnits(x.virtualBaseRemaining)}</td>
                <td>{x.fillCount.toString()}</td>
                <td>{formatUnits(x.baseFilled)}</td>
                <td>{x.active ? 'active' : 'paused'}</td>
                <td>
                  <button disabled={!!busy} onClick={() => act(x.active ? 'pause' : 'resume', () => setStrategyActive(x.id, !x.active))}>
                    {x.active ? 'Pause' : 'Resume'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {allowanceId && (
          <div className="row">
            <label>
              1 tUSD =
              <input value={price} onChange={(e) => setPrice(e.target.value)} /> tJPY
            </label>
            <button
              disabled={!!busy}
              onClick={() =>
                act('create fixed', () =>
                  createFixedStrategy({
                    allowanceId,
                    priceNum: 1_000_000n,
                    priceDen: parseUnits(price),
                    maxBasePerFill: s.allowance?.lifetimeCap ?? 0n,
                    virtualBaseLimit: s.allowance?.lifetimeCap ?? 0n,
                    expiresAtMs: Date.now() + 12 * HOUR,
                  }),
                )
              }
            >
              Add fixed-rate strategy
            </button>
            <label>
              Fee
              <input value={feeBps} onChange={(e) => setFeeBps(e.target.value)} /> bps
            </label>
            <button
              disabled={!!busy}
              onClick={() => {
                const inventory = s.allowance?.lifetimeCap ?? 0n;
                return act('create curve', () =>
                  createCurveStrategy({
                    allowanceId,
                    virtualBase: inventory,
                    virtualQuote: (inventory * 1_000_000n) / parseUnits(price),
                    feeBps: BigInt(feeBps),
                    maxBasePerFill: inventory,
                    virtualBaseLimit: inventory,
                    expiresAtMs: Date.now() + 12 * HOUR,
                  }),
                );
              }}
            >
              Add curve strategy
            </button>
          </div>
        )}
      </section>

      <section className="card wide">
        <h2>Activity</h2>
        {busy && <p>{busy}…</p>}
        <ul className="log">
          {log.map((line) => {
            const digest = line.split(': ')[1] ?? '';
            return <li key={line}>{digest.length > 40 ? line : <a href={explorerTx(digest)} target="_blank" rel="noreferrer">{line}</a>}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}
