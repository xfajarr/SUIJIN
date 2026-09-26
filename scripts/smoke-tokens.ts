// Live test of a pair with different decimals against the RUNNING server (bun run server):
// SUI (9 decimals) against tUSD (6), both directions, fixed and curve, exact in and exact out.
// Needs MAKER_SECRET_KEY and TAKER_SECRET_KEY with a little SUI in their address balances.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import {
  DEPLOYMENT,
  GRPC_URL,
  PRICE_SCALE,
  addressBalance,
  createStrategies,
  createTakerOrder,
  curveBaseOut,
  curveReservesFor,
  demoCoinsOf,
  fixedBaseOut,
  fixedPriceFor,
  formatUnits,
  issueAllowances,
  mintTestCoins,
  normalizeType,
} from '@suijin/sdk';

const SERVER = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8790}`;
const client = new SuiGrpcClient({ network: DEPLOYMENT.network, baseUrl: GRPC_URL() });
const maker = Ed25519Keypair.fromSecretKey(process.env.MAKER_SECRET_KEY!);
const taker = Ed25519Keypair.fromSecretKey(process.env.TAKER_SECRET_KEY!);
const SUI = '0x2::sui::SUI';
const { tUSD } = demoCoinsOf();
const dec = { unitDecimals: 9, pricedDecimals: 6 }; // the pair reads 1 SUI = P tUSD
const P = 3_200_000n; // 3.2 tUSD per SUI (a test price, not the market)
const FEE = 30n;
const HOUR = 3_600_000;
const sui = (v: bigint) => `${formatUnits(v, 9, 9)} SUI`;
const usd = (v: bigint) => `${formatUnits(v, 6, 6)} tUSD`;

type ServerQuote = { strategyId: string; baseType: string; quoteType: string; quoteIn: string; baseOut: string; minBaseOut: string };
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
  const created = (...fragments: string[]) =>
    r.Transaction.effects.changedObjects.find(
      (c) => c.idOperation === 'Created' && fragments.every((f) => normalizeType(r.Transaction.objectTypes[c.objectId] ?? '').includes(normalizeType(f))),
    )?.objectId ?? '';
  return { digest: r.Transaction.digest, created };
}

/** Quote until the indexer sees the new strategy. */
async function quoteFor(body: Record<string, string>, strategyId: string): Promise<ServerQuote> {
  for (let i = 0; i < 25; i++) {
    const quotes = await post<ServerQuote[] | { error: string }>('/v1/quote', body);
    if (!Array.isArray(quotes)) throw new Error(`quote: ${quotes.error}`);
    const hit = quotes.find((q) => q.strategyId === strategyId);
    if (hit) return hit;
    await Bun.sleep(1000);
  }
  throw new Error(`no quote from ${strategyId} for ${JSON.stringify(body)}`);
}

async function trade(q: ServerQuote) {
  const placed = await run(
    'order',
    createTakerOrder({
      strategyId: q.strategyId,
      quoteIn: BigInt(q.quoteIn),
      minBaseOut: BigInt(q.minBaseOut),
      quotedBaseOut: BigInt(q.baseOut),
      expiresAtMs: Date.now() + 10 * 60_000,
      recipient: taker.toSuiAddress(),
      pair: { base: q.baseType, quote: q.quoteType },
    }),
    taker,
  );
  const fill = await post<{ ok: boolean; digest?: string; error?: string }>(`/v1/orders/${placed.created('::order::SwapOrder<')}/fill`, {
    takerAllowanceId: placed.created('::allowance::Allowance<'),
  });
  check(fill.ok, `filled by the executor (${fill.digest ?? fill.error})`);
}

console.log('setup: maker holds tUSD, both hold SUI in their address balance');
await run('mint maker tUSD', mintTestCoins({ tusd: 10_000_000n }), maker);

console.log('grant one SUI budget and one tUSD budget (one tx), open a fixed and a curve market (one tx)');
const exp = Date.now() + 2 * HOUR;
const budgets = await run(
  'grant budgets',
  issueAllowances([
    { coin: SUI, cap: 100_000_000n, expiresAtMs: exp }, // 0.1 SUI
    { coin: tUSD.type, cap: 1_000_000n, expiresAtMs: exp }, // 1 tUSD
  ]),
  maker,
);
const suiBudget = budgets.created('::allowance::Allowance<', `${SUI}>`);
const usdBudget = budgets.created('::allowance::Allowance<', `${tUSD.type}>`);
check(!!suiBudget && !!usdBudget, 'a SUI allowance and a tUSD allowance');

const fixed = fixedPriceFor({ ...dec, sell: 'unit', price: P, feeBps: FEE }); // sells SUI, receives tUSD
const curve = curveReservesFor({ ...dec, sell: 'priced', price: P, amount: 1_000_000n, depth: 20n }); // sells tUSD, receives SUI
const markets = await run(
  'open markets',
  createStrategies([
    { kind: 'fixed', allowanceId: suiBudget, ...fixed, maxBasePerFill: 100_000_000n, virtualBaseLimit: 100_000_000n, expiresAtMs: exp, pair: { base: SUI, quote: tUSD.type } },
    { kind: 'curve', allowanceId: usdBudget, ...curve, feeBps: FEE, maxBasePerFill: 1_000_000n, virtualBaseLimit: 1_000_000n, expiresAtMs: exp, pair: { base: tUSD.type, quote: SUI } },
  ]),
  maker,
);
const fixedId = markets.created('::strategy::Strategy<', `${SUI},`);
const curveId = markets.created('::strategy::Strategy<', `${tUSD.type},`);
check(!!fixedId && !!curveId, `fixed SUI market ${fixedId.slice(0, 10)}… and curve tUSD market ${curveId.slice(0, 10)}…`);

console.log('A. exact in: taker pays 0.2 tUSD, receives SUI at 3.2 + 0.30%');
const a = await quoteFor({ sell: tUSD.type, buy: SUI, amountIn: '200000', slippageBps: '50' }, fixedId);
const expectA = fixedBaseOut(200_000n, fixed.priceNum, fixed.priceDen);
check(BigInt(a.baseOut) === expectA, `quote ${sui(BigInt(a.baseOut))} = Move formula`);
check(expectA > 62_000_000n && expectA < 62_700_000n, `≈ 0.2 / (3.2 × 1.003) = 0.0623 SUI`);
const suiBefore = await addressBalance(client, taker.toSuiAddress(), SUI);
const usdBeforeA = await addressBalance(client, taker.toSuiAddress(), tUSD.type);
await trade(a);
const usdSpent = usdBeforeA - (await addressBalance(client, taker.toSuiAddress(), tUSD.type));
check(usdSpent === 200_000n, `taker paid exactly ${usd(usdSpent)}`);
// Gas also comes out of the SUI address balance, so check the received amount through the fill: balance rose by at least baseOut minus gas.
const suiAfter = await addressBalance(client, taker.toSuiAddress(), SUI);
console.log(`  taker SUI ${sui(suiBefore)} -> ${sui(suiAfter)} (received ${sui(expectA)}, minus gas for the order tx)`);
check(suiAfter > suiBefore, 'taker SUI balance went up by the fill (net of gas)');

console.log('B. exact out: taker must receive exactly 0.05 tUSD, pays SUI into a curve');
const b = await quoteFor({ sell: SUI, buy: tUSD.type, amountOut: '50000', slippageBps: '50' }, curveId);
check(BigInt(b.minBaseOut) === 50_000n, `minimum out is the exact 0.05 tUSD; pays ${sui(BigInt(b.quoteIn))}`);
const outB = curveBaseOut(BigInt(b.quoteIn), curve.virtualBase, curve.virtualQuote, FEE);
check(outB >= 50_000n, `Move formula gives ${usd(outB)} for that input`);
const ideal = (50_000n * 10n ** 9n * PRICE_SCALE) / (P * 10n ** 6n); // 0.05 / 3.2 SUI, no fee
check(BigInt(b.quoteIn) > ideal && BigInt(b.quoteIn) < (ideal * 102n) / 100n, `input within 2% of 0.05 / 3.2 = ${sui(ideal)} (fee + slippage buffer)`);
const usdBeforeB = await addressBalance(client, taker.toSuiAddress(), tUSD.type);
await trade(b);
const usdGot = (await addressBalance(client, taker.toSuiAddress(), tUSD.type)) - usdBeforeB;
check(usdGot >= 50_000n, `taker received ${usd(usdGot)} (at least the exact amount)`);

console.log('\nTOKENS SMOKE OK');
