// Live smoke test for the RUNNING server (bun run server): drives it over HTTP
// exactly like the web app does: fill is requested immediately after the order tx.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { DEPLOYMENT, GRPC_URL, createFixedStrategy, createTakerOrder, getOrder, issueMakerAllowance, mintTestCoin } from '@suijin/sdk';

const SERVER = 'http://localhost:8790';
const client = new SuiGrpcClient({ network: DEPLOYMENT.network, baseUrl: GRPC_URL() });
const maker = Ed25519Keypair.fromSecretKey(process.env.MAKER_SECRET_KEY!);
const taker = Ed25519Keypair.fromSecretKey(process.env.TAKER_SECRET_KEY!);
const post = (path: string, body: unknown) =>
  fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

function check(ok: boolean, msg: string) {
  if (!ok) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run(label: string, tx: Transaction, signer: Ed25519Keypair) {
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
  if (r.$kind === 'FailedTransaction') throw new Error(`${label}: ${r.FailedTransaction.status.error?.message}`);
  await client.waitForTransaction({ result: r });
  console.log(`  ${label}: ${r.Transaction.digest}`);
  return (fragment: string) =>
    r.Transaction.effects.changedObjects.find((c) => c.idOperation === 'Created' && r.Transaction.objectTypes[c.objectId]?.includes(fragment))?.objectId ?? '';
}

const health = await fetch(`${SERVER}/v1/health`).then((r) => r.json());
check(health.ok === true && health.executor === DEPLOYMENT.executor, `health ok (${health.network})`);

console.log('maker setup');
await run('mint tJPY', mintTestCoin('tjpy', 1_000_000_000_000n), maker);
const issued = await run('allowance', issueMakerAllowance({ cap: 1_000_000_000_000n, expiresAtMs: Date.now() + 3_600_000 }), maker);
const allowanceId = issued('::allowance::Allowance<');
await run('fixed strategy', createFixedStrategy({ allowanceId, priceNum: 1n, priceDen: 150n, maxBasePerFill: 10n ** 12n, virtualBaseLimit: 10n ** 12n, expiresAtMs: Date.now() + 3_600_000 }), maker);

console.log('quote via server');
let quotes: { strategyId: string; makerAllowanceId: string; quoteIn: string; baseOut: string; minBaseOut: string }[] = [];
for (let i = 0; i < 20 && !quotes.some((q) => q.makerAllowanceId === allowanceId); i++) {
  quotes = await post('/v1/quote', { quoteIn: '10000000' });
  if (!quotes.some((q) => q.makerAllowanceId === allowanceId)) await Bun.sleep(1000);
}
const q = quotes.find((x) => x.makerAllowanceId === allowanceId);
check(!!q && q.baseOut === '1500000000', `server quoted 1,500 tJPY for 10 tUSD`);

console.log('taker order, then IMMEDIATE fill request (no client-side retry)');
await run('mint tUSD', mintTestCoin('tusd', 100_000_000n), taker);
const placed = await run(
  'order',
  createTakerOrder({ strategyId: q!.strategyId, quoteIn: BigInt(q!.quoteIn), minBaseOut: BigInt(q!.minBaseOut), quotedBaseOut: BigInt(q!.baseOut), expiresAtMs: Date.now() + 600_000, recipient: taker.toSuiAddress() }),
  taker,
);
const orderId = placed('::order::SwapOrder<');
const paymentId = placed('::allowance::Allowance<');
const fill = await post(`/v1/orders/${orderId}/fill`, { takerAllowanceId: paymentId });
check(fill.ok === true, `server filled the order right away (${fill.digest ?? fill.error})`);

const again = await post(`/v1/orders/${orderId}/fill`, { takerAllowanceId: paymentId });
check(again.ok === true && again.digest === fill.digest, 'second fill request is idempotent (same digest)');

for (let i = 0; i < 20; i++) {
  const o = await getOrder(orderId);
  if (o?.status === 'filled') break;
  await Bun.sleep(1000);
}
check((await getOrder(orderId))?.status === 'filled', 'order is filled on chain');
console.log('\nSERVER SMOKE OK');
