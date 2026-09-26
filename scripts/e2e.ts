// End-to-end proof on a live network (spec §21.3).
//   Testnet (team keys):  MAKER_SECRET_KEY=.. TAKER_SECRET_KEY=.. EXECUTOR_SECRET_KEY=.. bun scripts/e2e.ts
//   Fresh devnet run:     FRESH=1 bun scripts/e2e.ts   (new keys, faucet, fresh deploy)
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import {
  DEPLOYMENT,
  addressBalance,
  buildFill,
  buildQuotes,
  createCurveStrategy,
  createFixedStrategy,
  createTakerOrder,
  formatUnits,
  getAllowance,
  getOrder,
  getStrategy,
  issueMakerAllowance,
  listStrategies,
  mintTestCoin,
  revokeAllowance,
  typesOf,
  type Deployment,
} from '@suijin/sdk';
import { deploy } from './deploy';

const FRESH = process.env.FRESH === '1';
const key = (name: string) => {
  const secret = process.env[`${name}_SECRET_KEY`];
  if (FRESH) return new Ed25519Keypair();
  if (!secret) throw new Error(`${name}_SECRET_KEY missing`);
  return Ed25519Keypair.fromSecretKey(secret);
};
const [executor, maker, taker] = [key('EXECUTOR'), key('MAKER'), key('TAKER')];
const network: Deployment['network'] = FRESH ? 'devnet' : DEPLOYMENT.network;
const client = new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` });

const step = (msg: string) => console.log(`\n▶ ${msg}`);
function check(ok: boolean, msg: string) {
  if (!ok) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run(label: string, tx: Transaction, signer: Ed25519Keypair) {
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
  if (r.$kind === 'FailedTransaction') throw new Error(`${label}: ${r.FailedTransaction.status.error?.message}`);
  await client.waitForTransaction({ result: r });
  console.log(`  ${label}: ${r.Transaction.digest}`);
  const created = (fragment: string) =>
    r.Transaction.effects.changedObjects.find((c) => c.idOperation === 'Created' && r.Transaction.objectTypes[c.objectId]?.includes(fragment))?.objectId ?? '';
  return { digest: r.Transaction.digest, created };
}

/** GraphQL indexes a moment after the fullnode; poll until it has caught up. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 30; i++) {
    const v = await read();
    if (ok(v)) return v;
    await Bun.sleep(1000);
  }
  throw new Error('timed out waiting for the indexer');
}

let d: Deployment = DEPLOYMENT;
if (FRESH) {
  step('fresh devnet: faucet + deploy');
  await requestSuiFromFaucetV2({ host: getFaucetHost('devnet'), recipient: executor.toSuiAddress() });
  await eventually(() => client.getBalance({ owner: executor.toSuiAddress() }), (r) => BigInt(r.balance.balance) > 0n);
  const gas = new Transaction();
  const [a, b] = gas.splitCoins(gas.gas, [500_000_000n, 500_000_000n]);
  gas.transferObjects([a!], maker.toSuiAddress());
  gas.transferObjects([b!], taker.toSuiAddress());
  await run('gas for maker and taker', gas, executor);
  d = await deploy(executor, 'devnet');
}
const t = typesOf(d);
const now = Date.now();
const HOUR = 3_600_000;

step('maker mints 1,000,000 tJPY into its address balance');
await run('mint tJPY', mintTestCoin('tjpy', 1_000_000_000_000n, d), maker);
const makerJpy0 = await addressBalance(client, maker.toSuiAddress(), t.base);
console.log(`  maker tJPY: ${formatUnits(makerJpy0)}`);

step('maker issues ONE app-bound allowance over the whole inventory');
const issued = await run('issue allowance', issueMakerAllowance({ cap: 1_000_000_000_000n, expiresAtMs: now + 6 * HOUR }, d), maker);
const allowanceId = issued.created('::allowance::Allowance<');
const capId = issued.created('::allowance::AllowanceCap<');

step('maker creates TWO strategies on the same allowance');
const fixed = await run('create fixed', createFixedStrategy({ allowanceId, priceNum: 1n, priceDen: 150n, maxBasePerFill: 1_000_000_000_000n, virtualBaseLimit: 1_000_000_000_000n, expiresAtMs: now + 6 * HOUR }, d), maker);
const curve = await run('create curve', createCurveStrategy({ allowanceId, virtualBase: 1_000_000_000_000n, virtualQuote: 6_666_666_666n, feeBps: 30n, maxBasePerFill: 1_000_000_000_000n, virtualBaseLimit: 1_000_000_000_000n, expiresAtMs: now + 6 * HOUR }, d), maker);
const fixedId = fixed.created('::strategy::Strategy<');
const curveId = curve.created('::strategy::Strategy<');
check((await addressBalance(client, maker.toSuiAddress(), t.base)) === makerJpy0, 'creating strategies moved zero tJPY');

step('taker mints 100 tUSD and asks for quotes');
await run('mint tUSD', mintTestCoin('tusd', 100_000_000n, d), taker);
const strategies = await eventually(() => listStrategies(d), (s) => s.filter((x) => x.id === fixedId || x.id === curveId).length === 2);
const mine = strategies.filter((s) => s.id === fixedId || s.id === curveId);
const allowance = await eventually(() => getAllowance(allowanceId, d), (a) => a !== null);
const quotes = buildQuotes({
  strategies: mine,
  allowances: new Map([[allowanceId, allowance!]]),
  makerBalances: new Map([[maker.toSuiAddress(), makerJpy0]]),
  quoteIn: 10_000_000n,
  nowMs: Date.now(),
});
check(quotes.length === 2, `both strategies quote (${quotes.map((q) => `${q.kind}=${formatUnits(q.baseOut)}`).join(', ')})`);
const best = quotes[0]!;

step('taker signs ONE tx: exact-cap payment allowance + order');
const takerUsd0 = await addressBalance(client, taker.toSuiAddress(), t.quote);
const placed = await run(
  'create order',
  createTakerOrder({ strategyId: best.strategyId, quoteIn: best.quoteIn, minBaseOut: best.minBaseOut, quotedBaseOut: best.baseOut, expiresAtMs: Date.now() + 10 * 60_000, recipient: taker.toSuiAddress() }, d),
  taker,
);
const orderId = placed.created('::order::SwapOrder<');
const paymentId = placed.created('::allowance::Allowance<');
check((await addressBalance(client, taker.toSuiAddress(), t.quote)) === takerUsd0, 'placing the order moved zero tUSD');

step('executor settles both sides in ONE PTB');
const fill = await run(
  'fill',
  buildFill({ strategyId: best.strategyId, orderId, maker: maker.toSuiAddress(), makerAllowanceId: allowanceId, taker: taker.toSuiAddress(), takerAllowanceId: paymentId, baseOut: best.baseOut, quoteIn: best.quoteIn }, d),
  executor,
);
const order = await eventually(() => getOrder(orderId, d), (o) => o?.status === 'filled');
check(order?.status === 'filled', `order filled (${fill.digest})`);
check((await addressBalance(client, maker.toSuiAddress(), t.base)) === makerJpy0 - best.baseOut, `maker tJPY -${formatUnits(best.baseOut)}`);
check((await addressBalance(client, maker.toSuiAddress(), t.quote)) === best.quoteIn, `maker tUSD +${formatUnits(best.quoteIn)}`);
check((await addressBalance(client, taker.toSuiAddress(), t.base)) === best.baseOut, `taker tJPY +${formatUnits(best.baseOut)}`);
const chosen = await eventually(() => getStrategy(best.strategyId, d), (s) => s?.fillCount === 1n);
check(chosen?.baseFilled === best.baseOut, 'strategy recorded the fill');

step('executor tries to overdraw the maker: must abort');
const o2 = await run(
  'second order',
  createTakerOrder({ strategyId: best.strategyId, quoteIn: best.quoteIn, minBaseOut: 1n, quotedBaseOut: best.baseOut, expiresAtMs: Date.now() + 10 * 60_000, recipient: taker.toSuiAddress() }, d),
  taker,
);
const greedy = await client
  .signAndExecuteTransaction({
    transaction: buildFill({ strategyId: best.strategyId, orderId: o2.created('::order::SwapOrder<'), maker: maker.toSuiAddress(), makerAllowanceId: allowanceId, taker: taker.toSuiAddress(), takerAllowanceId: o2.created('::allowance::Allowance<'), baseOut: best.baseOut * 2n, quoteIn: best.quoteIn }, d),
    signer: executor,
  })
  .then((r) => r.$kind, (e: Error) => `rejected: ${e.message.slice(0, 80)}`);
check(greedy !== 'Transaction', `overdraw refused (${greedy})`);

step('maker revokes; the next fill must fail');
await run('revoke', revokeAllowance({ coin: t.base, allowanceId, capId }), maker);
const afterRevoke = await client
  .signAndExecuteTransaction({
    transaction: buildFill({ strategyId: best.strategyId, orderId: o2.created('::order::SwapOrder<'), maker: maker.toSuiAddress(), makerAllowanceId: allowanceId, taker: taker.toSuiAddress(), takerAllowanceId: o2.created('::allowance::Allowance<'), baseOut: best.baseOut, quoteIn: best.quoteIn }, d),
    signer: executor,
  })
  .then((r) => r.$kind, (e: Error) => `rejected: ${e.message.slice(0, 80)}`);
check(afterRevoke !== 'Transaction', `fill after revoke refused (${afterRevoke})`);

console.log('\nE2E OK');
