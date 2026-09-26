// Live test of the DeFi actions against the RUNNING server (bun run server):
// reverse swap, two-sided liquidity, exact-output payment, fill history.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import {
  DEPLOYMENT,
  GRPC_URL,
  addressBalance,
  coinsOf,
  createStrategies,
  createTakerOrder,
  formatUnits,
  getOrder,
  issueAllowances,
  listFills,
  mintTestCoins,
} from '@suijin/sdk';

const SERVER = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8790}`;
const client = new SuiGrpcClient({ network: DEPLOYMENT.network, baseUrl: GRPC_URL() });
const provider = Ed25519Keypair.fromSecretKey(process.env.MAKER_SECRET_KEY!);
const trader = Ed25519Keypair.fromSecretKey(process.env.TAKER_SECRET_KEY!);
const merchant = new Ed25519Keypair().toSuiAddress(); // fresh address: receives only
const { tJPY, tUSD } = coinsOf();
const HOUR = 3_600_000;

type ServerQuote = { strategyId: string; kind: string; makerAllowanceId: string; baseType: string; quoteType: string; quoteIn: string; baseOut: string; minBaseOut: string };
const post = <T>(path: string, body: unknown): Promise<T> =>
  fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);

function check(ok: boolean, msg: string) {
  if (!ok) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run(label: string, tx: Transaction, signer: Ed25519Keypair) {
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
  if (r.$kind === 'FailedTransaction') throw new Error(`${label}: ${r.FailedTransaction.status.error?.message}`);
  await client.waitForTransaction({ result: r });
  console.log(`  ${label}: ${r.Transaction.digest}`);
  const all = (fragment: string) =>
    r.Transaction.effects.changedObjects
      .filter((c) => c.idOperation === 'Created' && r.Transaction.objectTypes[c.objectId]?.includes(fragment))
      .map((c) => ({ id: c.objectId, type: r.Transaction.objectTypes[c.objectId]! }));
  return { digest: r.Transaction.digest, all };
}

/** Quote until the indexer sees the new strategies (they are created a moment earlier). */
async function quoteFor(body: Record<string, string>, strategyIds: string[]): Promise<ServerQuote> {
  for (let i = 0; i < 25; i++) {
    const quotes = await post<ServerQuote[]>('/v1/quote', body);
    const hit = quotes.find((q) => strategyIds.includes(q.strategyId));
    if (hit) return hit;
    await Bun.sleep(1000);
  }
  throw new Error(`no quote from ${strategyIds.join(', ')} for ${JSON.stringify(body)}`);
}

/** Trader signs the order, then asks the executor to settle it right away, like the web app. */
async function trade(q: ServerQuote, recipient: string, minBaseOut: bigint) {
  const placed = await run(
    'order',
    createTakerOrder({
      strategyId: q.strategyId,
      quoteIn: BigInt(q.quoteIn),
      minBaseOut,
      quotedBaseOut: BigInt(q.baseOut),
      expiresAtMs: Date.now() + 10 * 60_000,
      recipient,
      pair: { base: q.baseType, quote: q.quoteType },
    }),
    trader,
  );
  const orderId = placed.all('::order::SwapOrder<')[0]!.id;
  const paymentId = placed.all('::allowance::Allowance<')[0]!.id;
  const fill = await post<{ ok: boolean; digest?: string; error?: string }>(`/v1/orders/${orderId}/fill`, { takerAllowanceId: paymentId });
  check(fill.ok, `filled (${fill.digest ?? fill.error})`);
  return { orderId, digest: fill.digest! };
}

console.log('setup: provider and trader hold both coins');
await run('mint provider', mintTestCoins({ tjpy: 1_000_000_000_000n, tusd: 10_000_000_000n }), provider);
await run('mint trader', mintTestCoins({ tjpy: 10_000_000_000n, tusd: 1_000_000_000n }), trader);

console.log('two-sided liquidity: one budget per coin (one tx), two curves (one tx)');
const budgets = await run(
  'grant both budgets',
  issueAllowances([
    { coin: tJPY.type, cap: 1_000_000_000_000n, expiresAtMs: Date.now() + 6 * HOUR },
    { coin: tUSD.type, cap: 10_000_000_000n, expiresAtMs: Date.now() + 6 * HOUR },
  ]),
  provider,
);
const jpyBudget = budgets.all('::allowance::Allowance<').find((o) => o.type.includes('::tjpy::TJPY'))!.id;
const usdBudget = budgets.all('::allowance::Allowance<').find((o) => o.type.includes('::tusd::TUSD'))!.id;
check(!!jpyBudget && !!usdBudget, 'one allowance per coin in a single transaction');
const curves = await run(
  'create both curves',
  createStrategies([
    // sells tJPY for tUSD around 150 tJPY per tUSD
    { kind: 'curve', allowanceId: jpyBudget, virtualBase: 1_000_000_000_000n, virtualQuote: 6_666_666_666n, feeBps: 30n, maxBasePerFill: 1_000_000_000_000n, virtualBaseLimit: 1_000_000_000_000n, expiresAtMs: Date.now() + 6 * HOUR, pair: { base: tJPY.type, quote: tUSD.type } },
    // sells tUSD for tJPY around the same price
    { kind: 'curve', allowanceId: usdBudget, virtualBase: 6_666_666_666n, virtualQuote: 1_000_000_000_000n, feeBps: 30n, maxBasePerFill: 10_000_000_000n, virtualBaseLimit: 10_000_000_000n, expiresAtMs: Date.now() + 6 * HOUR, pair: { base: tUSD.type, quote: tJPY.type } },
  ]),
  provider,
);
const curveIds = curves.all('::strategy::Strategy<').map((o) => o.id);
check(curveIds.length === 2, 'two curve strategies in a single transaction');

console.log('reverse swap: trader pays 1,500 tJPY, receives tUSD');
const reverse = await quoteFor({ sell: 'tJPY', buy: 'tUSD', amountIn: '1500000000' }, curveIds);
check(reverse.baseType.includes('::tusd::TUSD'), `quoted ${formatUnits(BigInt(reverse.baseOut))} tUSD for 1,500 tJPY`);
const usdBefore = await addressBalance(client, trader.toSuiAddress(), tUSD.type);
await trade(reverse, trader.toSuiAddress(), BigInt(reverse.minBaseOut));
check((await addressBalance(client, trader.toSuiAddress(), tUSD.type)) - usdBefore === BigInt(reverse.baseOut), 'trader received the quoted tUSD');

console.log('forward swap on the same position: trader pays 10 tUSD, receives tJPY');
const forward = await quoteFor({ sell: 'tUSD', buy: 'tJPY', amountIn: '10000000' }, curveIds);
await trade(forward, trader.toSuiAddress(), BigInt(forward.minBaseOut));

console.log('pay: merchant must receive exactly 1,500 tJPY, trader pays in tUSD');
const pay = await quoteFor({ sell: 'tUSD', buy: 'tJPY', amountOut: '1500000000' }, curveIds);
check(BigInt(pay.minBaseOut) === 1_500_000_000n, `needs ${formatUnits(BigInt(pay.quoteIn))} tUSD, minimum out is the exact amount`);
const paid = await trade(pay, merchant, BigInt(pay.minBaseOut));
check((await addressBalance(client, merchant, tJPY.type)) >= 1_500_000_000n, 'merchant received at least 1,500 tJPY');
check((await getOrder(paid.orderId))?.recipient === merchant, 'order recipient is the merchant');

console.log('history');
let fills = await listFills();
for (let i = 0; i < 15 && !fills.some((f) => f.digest === paid.digest); i++) {
  await Bun.sleep(1000);
  fills = await listFills();
}
check(fills.some((f) => f.digest === paid.digest), `listFills sees the payment (${fills.length} recent fills)`);

console.log('\nDEFI SMOKE OK');
