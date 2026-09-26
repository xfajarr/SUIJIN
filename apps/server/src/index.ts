import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  DEPLOYMENT,
  GRPC_URL,
  addressBalance,
  buildQuotes,
  getAllowance,
  listStrategies,
  typesOf,
  type AllowanceState,
} from '@suijin/sdk';
import { fillOrder } from './executor';

const secret = process.env.EXECUTOR_SECRET_KEY;
if (!secret) throw new Error('EXECUTOR_SECRET_KEY missing. Get it with: sui keytool export --key-identity executor');
const signer = Ed25519Keypair.fromSecretKey(secret);
if (signer.toSuiAddress() !== DEPLOYMENT.executor) {
  throw new Error(`executor key ${signer.toSuiAddress()} does not match deployment executor ${DEPLOYMENT.executor}`);
}
const client = new SuiGrpcClient({ network: DEPLOYMENT.network, baseUrl: GRPC_URL() });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
const preflight = () => new Response(null, { headers: cors });

async function quotes(quoteIn: bigint) {
  const strategies = await listStrategies();
  const makers = [...new Set(strategies.map((s) => s.maker))];
  const allowanceIds = [...new Set(strategies.map((s) => s.makerAllowanceId))];
  const [balances, allowances] = await Promise.all([
    Promise.all(makers.map(async (m) => [m, await addressBalance(client, m, typesOf().base)] as const)),
    Promise.all(allowanceIds.map(async (id) => [id, await getAllowance(id)] as const)),
  ]);
  const live = allowances.filter((entry): entry is readonly [string, AllowanceState] => entry[1] !== null);
  return buildQuotes({
    strategies,
    makerBalances: new Map(balances),
    allowances: new Map(live),
    quoteIn,
    nowMs: Date.now(),
  });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  routes: {
    '/v1/health': () => json({ ok: true, network: DEPLOYMENT.network, executor: DEPLOYMENT.executor }),
    '/v1/strategies': { GET: async () => json(await listStrategies()), OPTIONS: preflight },
    '/v1/quote': {
      OPTIONS: preflight,
      POST: async (req) => {
        const body = (await req.json()) as { quoteIn?: string };
        if (!body.quoteIn || !/^\d+$/.test(body.quoteIn)) return json({ error: 'quoteIn must be an integer string' }, 400);
        return json(await quotes(BigInt(body.quoteIn)));
      },
    },
    '/v1/orders/:id/fill': {
      OPTIONS: preflight,
      POST: async (req) => {
        const body = (await req.json()) as { takerAllowanceId?: string };
        if (!body.takerAllowanceId) return json({ error: 'takerAllowanceId required' }, 400);
        const outcome = await fillOrder(client, signer, req.params.id, body.takerAllowanceId);
        return json(outcome, outcome.ok ? 200 : 409);
      },
    },
  },
  fetch: () => json({ error: 'NOT_FOUND' }, 404),
});

console.log(`suijin server on ${server.url} (${DEPLOYMENT.network}, executor ${DEPLOYMENT.executor})`);
