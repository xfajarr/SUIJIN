import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { DEPLOYMENT, GRAPHQL_URL, typesOf, type Deployment } from './config';
import { parseAllowance, parseOrder, parseStrategy, type AllowanceState, type OrderState, type StrategyState } from './state';

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

type Node = { address: string; asMoveObject: { contents: { json: Record<string, unknown> } } | null };

export async function listStrategies(d: Deployment = DEPLOYMENT): Promise<StrategyState[]> {
  const data = await gql<{ objects: { nodes: Node[] } }>(
    `query ($type: String!) { objects(first: 50, filter: { type: $type }) { nodes { address asMoveObject { contents { json } } } } }`,
    { type: typesOf(d).strategy },
    d,
  );
  return data.objects.nodes.filter((n) => n.asMoveObject).map((n) => parseStrategy(n.asMoveObject!.contents.json));
}

async function objectJson(id: string, d: Deployment): Promise<Record<string, unknown> | null> {
  const data = await gql<{ object: Node | null }>(
    `query ($id: SuiAddress!) { object(address: $id) { address asMoveObject { contents { json } } } }`,
    { id },
    d,
  );
  return data.object?.asMoveObject?.contents.json ?? null;
}

export async function getStrategy(id: string, d: Deployment = DEPLOYMENT): Promise<StrategyState | null> {
  const json = await objectJson(id, d);
  return json && parseStrategy(json);
}

export async function getOrder(id: string, d: Deployment = DEPLOYMENT): Promise<OrderState | null> {
  const json = await objectJson(id, d);
  return json && parseOrder(json);
}

/** null when the allowance was revoked (object deleted). */
export async function getAllowance(id: string, d: Deployment = DEPLOYMENT): Promise<AllowanceState | null> {
  const json = await objectJson(id, d);
  return json && parseAllowance(json);
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

/** Address-balance part only (coins held as objects are not spendable by allowances). */
export async function addressBalance(client: SuiGrpcClient, owner: string, coinType: string): Promise<bigint> {
  const { balance } = await client.getBalance({ owner, coinType });
  return BigInt(balance.addressBalance);
}
