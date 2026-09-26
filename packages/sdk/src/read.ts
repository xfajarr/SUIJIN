import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { DEPLOYMENT, GRAPHQL_URL, typesOf, type CoinInfo, type Deployment } from './config';
import { parseAllowance, parseOrder, parseStrategy, typeArgs, type AllowanceState, type OrderState, type StrategyState } from './state';

// Object reads go through GraphQL: one stable JSON shape. Balances and execution go through gRPC.
async function gql<T>(query: string, variables: Record<string, unknown>, d: Deployment): Promise<T> {
  const res = await fetch(GRAPHQL_URL(d), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data as T;
}

type Contents = { type: { repr: string }; json: Record<string, unknown> };
type Node = { address: string; asMoveObject: { contents: Contents } | null };

type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

/** Walks a paginated GraphQL connection. ponytail: stops at 10 pages (500 items); an indexer takes over past that. */
async function allPages<T>(fetchPage: (after: string | null) => Promise<Page<T> | null>): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page: Page<T> | null = await fetchPage(after);
    if (!page) break;
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

export async function listStrategies(d: Deployment = DEPLOYMENT): Promise<StrategyState[]> {
  const nodes = await allPages(async (after) =>
    (
      await gql<{ objects: Page<Node> }>(
        `query ($type: String!, $after: String) { objects(first: 50, after: $after, filter: { type: $type }) { ${PAGE_INFO} nodes { address asMoveObject { contents { type { repr } json } } } } }`,
        { type: typesOf(d).strategy, after },
        d,
      )
    ).objects,
  );
  return nodes.filter((n) => n.asMoveObject).map((n) => parseStrategy(n.asMoveObject!.contents.json, n.asMoveObject!.contents.type.repr));
}

async function objectContents(id: string, d: Deployment): Promise<Contents | null> {
  const data = await gql<{ object: Node | null }>(
    `query ($id: SuiAddress!) { object(address: $id) { address asMoveObject { contents { type { repr } json } } } }`,
    { id },
    d,
  );
  return data.object?.asMoveObject?.contents ?? null;
}

export async function getStrategy(id: string, d: Deployment = DEPLOYMENT): Promise<StrategyState | null> {
  const c = await objectContents(id, d);
  return c && parseStrategy(c.json, c.type.repr);
}

export async function getOrder(id: string, d: Deployment = DEPLOYMENT): Promise<OrderState | null> {
  const c = await objectContents(id, d);
  return c && parseOrder(c.json, c.type.repr);
}

/** null when the allowance was revoked (object deleted). */
export async function getAllowance(id: string, d: Deployment = DEPLOYMENT): Promise<AllowanceState | null> {
  const c = await objectContents(id, d);
  return c && parseAllowance(c.json);
}

/** Allowances this funder issued for `coin`, found through the AllowanceCap objects they own. */
export async function listAllowanceCaps(
  owner: string,
  coin: string,
  d: Deployment = DEPLOYMENT,
): Promise<{ capId: string; allowanceId: string }[]> {
  // Owned objects come back as MoveObject already: `contents` sits directly on the node.
  type OwnedNode = { address: string; contents: { json: Record<string, unknown> } };
  const nodes = await allPages(async (after) => {
    const data = await gql<{ address: { objects: Page<OwnedNode> } | null }>(
      `query ($owner: SuiAddress!, $type: String!, $after: String) { address(address: $owner) { objects(first: 50, after: $after, filter: { type: $type }) { ${PAGE_INFO} nodes { address contents { json } } } } }`,
      { owner, type: typesOf(d).allowanceCap(coin), after },
      d,
    );
    return data.address?.objects ?? null;
  });
  return nodes.map((n) => ({ capId: n.address, allowanceId: String(n.contents.json.allowance) }));
}

export type FillEvent = {
  digest: string;
  orderId: string;
  strategyId: string;
  maker: string;
  taker: string;
  recipient: string;
  baseType: string;
  quoteType: string;
  quoteIn: bigint;
  baseOut: bigint;
  timestampMs: number;
};

/** Most recent settlements, newest first. Filter by maker/taker/recipient on the client. */
export async function listFills(d: Deployment = DEPLOYMENT, last = 40): Promise<FillEvent[]> {
  type EventNode = { contents: Contents; transaction: { digest: string } | null };
  const data = await gql<{ events: { nodes: EventNode[] } }>(
    `query ($type: String!, $last: Int!) { events(last: $last, filter: { type: $type }) { nodes { contents { type { repr } json } transaction { digest } } } }`,
    { type: `${d.packageId}::settlement::Fill`, last },
    d,
  );
  return data.events.nodes
    .map((n) => {
      const j = n.contents.json;
      const [baseType = '', quoteType = ''] = typeArgs(n.contents.type.repr);
      return {
        digest: n.transaction?.digest ?? '',
        orderId: String(j.order_id),
        strategyId: String(j.strategy_id),
        maker: String(j.maker),
        taker: String(j.taker),
        recipient: String(j.recipient),
        baseType,
        quoteType,
        quoteIn: BigInt(String(j.quote_in)),
        baseOut: BigInt(String(j.base_out)),
        timestampMs: Number(j.timestamp_ms),
      };
    })
    .reverse();
}

// Fresh reads straight from a fullnode (gRPC): no indexer lag. Use them for anything that prices
// or settles a trade; GraphQL above is for discovery and history. Same JSON shape as GraphQL.
async function freshContents(client: SuiGrpcClient, ids: string[]): Promise<Map<string, { type: string; json: Record<string, unknown> }>> {
  const out = new Map<string, { type: string; json: Record<string, unknown> }>();
  const chunks = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));
  const pages = await Promise.all(chunks.map((objectIds) => client.getObjects({ objectIds, include: { json: true } })));
  for (const o of pages.flatMap((p) => p.objects)) {
    if (o instanceof Error || !o.json) continue; // deleted (e.g. a revoked allowance) or missing
    out.set(o.objectId, { type: o.type, json: o.json });
  }
  return out;
}

export async function freshStrategies(client: SuiGrpcClient, ids: string[]): Promise<StrategyState[]> {
  const found = await freshContents(client, ids);
  return ids.flatMap((id) => {
    const c = found.get(id);
    return c ? [parseStrategy(c.json, c.type)] : [];
  });
}

/** Missing ids are absent from the map: those allowances were revoked. */
export async function freshAllowances(client: SuiGrpcClient, ids: string[]): Promise<Map<string, AllowanceState>> {
  const found = await freshContents(client, ids);
  return new Map([...found].map(([id, c]) => [id, parseAllowance(c.json)] as const));
}

export async function freshOrder(client: SuiGrpcClient, id: string): Promise<OrderState | null> {
  const c = (await freshContents(client, [id])).get(id);
  return c ? parseOrder(c.json, c.type) : null;
}

/** Address-balance part only (coins held as objects are not spendable by allowances). */
export async function addressBalance(client: SuiGrpcClient, owner: string, coinType: string): Promise<bigint> {
  const { balance } = await client.getBalance({ owner, coinType });
  return BigInt(balance.addressBalance);
}

/**
 * Registry entry for any coin type, from its on-chain metadata (Coin Registry or CoinMetadata).
 * null when the type has no metadata, so it is not a coin people can hold.
 */
export async function fetchCoinInfo(coinType: string, d: Deployment = DEPLOYMENT): Promise<CoinInfo | null> {
  const data = await gql<{ coinMetadata: { symbol: string; name: string; decimals: number; iconUrl: string | null } | null }>(
    'query($t: String!) { coinMetadata(coinType: $t) { symbol name decimals iconUrl } }',
    { t: coinType },
    d,
  );
  const m = data.coinMetadata;
  if (!m) return null;
  return { key: m.symbol, type: coinType, symbol: m.symbol, name: m.name, decimals: m.decimals, ...(m.iconUrl ? { iconUrl: m.iconUrl } : {}) };
}

/** Whole balance of a coin: the address-balance part Allowances can spend, and the part still in Coin objects. */
export async function splitBalance(client: SuiGrpcClient, owner: string, coinType: string): Promise<{ address: bigint; coins: bigint }> {
  const { balance } = await client.getBalance({ owner, coinType });
  const address = BigInt(balance.addressBalance);
  return { address, coins: BigInt(balance.balance) - address };
}
