import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  DEPLOYMENT,
  GRPC_URL,
  addressBalance,
  balanceKey,
  buildQuotes,
  freshAllowances,
  freshStrategies,
  listStrategies,
  resolveCoin,
  sameType,
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

type QuoteRequest = { buy: string; sell: string; slippageBps?: bigint } & ({ quoteIn: bigint } | { baseOut: bigint });

/** Quotes for a trader who pays `sell` and receives `buy`, exact input or exact output. */
async function quotes(req: QuoteRequest) {
  // GraphQL finds the strategies; their state is then re-read from the fullnode, because a quote
  // priced on a lagging index can fail at settlement.
  const now = BigInt(Date.now());
  const listed = (await listStrategies()).filter((s) => s.expiryMs > now && sameType(s.baseType, req.buy) && sameType(s.quoteType, req.sell));
  const strategies = await freshStrategies(client, listed.map((s) => s.id));
  const holders = [...new Map(strategies.map((s) => [balanceKey(s.maker, s.baseType), s] as const)).values()];
  const [balances, allowances] = await Promise.all([
    Promise.all(holders.map(async (s) => [balanceKey(s.maker, s.baseType), await addressBalance(client, s.maker, s.baseType)] as const)),
    freshAllowances(client, [...new Set(strategies.map((s) => s.makerAllowanceId))]),
  ]);
  const common = { strategies, makerBalances: new Map(balances), allowances, base: req.buy, quote: req.sell, nowMs: Date.now(), slippageBps: req.slippageBps };
  return 'quoteIn' in req ? buildQuotes({ ...common, quoteIn: req.quoteIn }) : buildQuotes({ ...common, baseOut: req.baseOut });
}

/**
 * Body: { sell: 'tUSD' | coin type, buy: 'tJPY' | coin type, amountIn | amountOut: integer string, slippageBps?: 0..1000 }.
 * The original { quoteIn } body still means "pay tUSD, receive tJPY".
 */
function parseQuoteRequest(body: Record<string, unknown>): QuoteRequest | string {
  const sell = resolveCoin(String(body.sell ?? 'tUSD'));
  const buy = resolveCoin(String(body.buy ?? 'tJPY'));
  if (!sell || !buy || sell.type === buy.type) return 'sell and buy must be two different coins (tUSD, tJPY)';
  const amountIn = body.amountIn ?? body.quoteIn;
  const amountOut = body.amountOut;
  const isInt = (v: unknown) => typeof v === 'string' && /^[1-9]\d*$/.test(v);
  const bps = Number(body.slippageBps ?? 100);
  if (!Number.isInteger(bps) || bps < 0 || bps > 1000) return 'slippageBps must be an integer from 0 to 1000';
  const slippageBps = BigInt(bps);
  if (isInt(amountIn) && amountOut === undefined) return { sell: sell.type, buy: buy.type, slippageBps, quoteIn: BigInt(amountIn as string) };
  if (isInt(amountOut) && amountIn === undefined) return { sell: sell.type, buy: buy.type, slippageBps, baseOut: BigInt(amountOut as string) };
  return 'send exactly one of amountIn or amountOut as a positive integer string';
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8790),
  routes: {
    // api 2: quotes in either direction, exact input or output. The web app checks it.
    '/v1/health': () => json({ ok: true, network: DEPLOYMENT.network, executor: DEPLOYMENT.executor, api: 2 }),
    '/v1/strategies': { GET: async () => json(await listStrategies()), OPTIONS: preflight },
    '/v1/quote': {
      OPTIONS: preflight,
      POST: async (req) => {
        const parsed = parseQuoteRequest((await req.json()) as Record<string, unknown>);
        if (typeof parsed === 'string') return json({ error: parsed }, 400);
        return json(await quotes(parsed));
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
