import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  DEPLOYMENT,
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

type QuoteRequest = { buy: string; sell: string; slippageBps?: bigint } & ({ quoteIn: bigint } | { baseOut: bigint });

/** Quotes for a trader who pays `sell` and receives `buy`, exact input or exact output. */
async function quotes(client: SuiGrpcClient, req: QuoteRequest) {
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
/** A listed symbol or type, or any well-formed coin type: markets exist for whatever providers list. */
const COIN_TYPE = /^0x[0-9a-fA-F]{1,64}::\w+::\w+$/;
const coinType = (v: string) => resolveCoin(v) ?? (COIN_TYPE.test(v) ? { type: v } : undefined);

function parseQuoteRequest(body: Record<string, unknown>): QuoteRequest | string {
  const sell = coinType(String(body.sell ?? 'tUSD'));
  const buy = coinType(String(body.buy ?? 'tJPY'));
  if (!sell || !buy || sameType(sell.type, buy.type)) return 'sell and buy must be two different coins: a listed symbol (tUSD, SUI, USDC, …) or a full coin type';
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

const readBody = async (req: Request) => {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
};

/** The HTTP API as one fetch handler, shared by the local Bun server and the Cloudflare Worker. */
export function createApp(client: SuiGrpcClient, signer: Ed25519Keypair) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const { pathname } = new URL(req.url);
    try {
      // api 2: quotes in either direction, exact input or output. The web app checks it.
      if (req.method === 'GET' && pathname === '/v1/health') return json({ ok: true, network: DEPLOYMENT.network, executor: DEPLOYMENT.executor, api: 2 });
      if (req.method === 'GET' && pathname === '/v1/strategies') return json(await listStrategies());
      if (req.method === 'POST' && pathname === '/v1/quote') {
        const body = await readBody(req);
        if (!body) return json({ error: 'body must be a JSON object' }, 400);
        const parsed = parseQuoteRequest(body);
        if (typeof parsed === 'string') return json({ error: parsed }, 400);
        return json(await quotes(client, parsed));
      }
      const fill = pathname.match(/^\/v1\/orders\/(0x[0-9a-fA-F]{1,64})\/fill$/);
      if (req.method === 'POST' && fill) {
        const body = await readBody(req);
        if (typeof body?.takerAllowanceId !== 'string') return json({ error: 'takerAllowanceId required' }, 400);
        const outcome = await fillOrder(client, signer, fill[1]!, body.takerAllowanceId);
        return json(outcome, outcome.ok ? 200 : 409);
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (e) {
      // Upstream (fullnode or GraphQL) failures still answer with CORS headers, so browsers see the message.
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  };
}
