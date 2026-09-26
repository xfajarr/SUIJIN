import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { DEPLOYMENT, GRAPHQL_URL, typesOf, type Deployment } from './config';
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

export async function listStrategies(d: Deployment = DEPLOYMENT): Promise<StrategyState[]> {
  const data = await gql<{ objects: { nodes: Node[] } }>(
    `query ($type: String!) { objects(first: 50, filter: { type: $type }) { nodes { address asMoveObject { contents { type { repr } json } } } } }`,
    { type: typesOf(d).strategy },
    d,
  );
  return data.objects.nodes
    .filter((n) => n.asMoveObject)
    .map((n) => parseStrategy(n.asMoveObject!.contents.json, n.asMoveObject!.contents.type.repr));
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
  const data = await gql<{ address: { objects: { nodes: OwnedNode[] } } | null }>(
    `query ($owner: SuiAddress!, $type: String!) { address(address: $owner) { objects(first: 50, filter: { type: $type }) { nodes { address contents { json } } } } }`,
    { owner, type: typesOf(d).allowanceCap(coin) },
    d,
  );
  return (data.address?.objects.nodes ?? []).map((n) => ({
    capId: n.address,
    allowanceId: String(n.contents.json.allowance),
  }));
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
  if (ids.length === 0) return out;
  const { objects } = await client.getObjects({ objectIds: ids, include: { json: true } });
  for (const o of objects) {
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
