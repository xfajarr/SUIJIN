import { Transaction, type TransactionResult } from '@mysten/sui/transactions';
import { DEPLOYMENT, typesOf, type Deployment } from './config';

type RateLimit = { periodMs: number; limit: bigint };

/** `0x2::allowance::propose_for_app<Balance<coin>, App>` with spender = executor. Returns the proposal. */
function propose(
  tx: Transaction,
  d: Deployment,
  coin: string,
  name: string,
  cap: bigint,
  expiresAtMs: number,
  rateLimit?: RateLimit,
): TransactionResult {
  const rl = rateLimit
    ? tx.moveCall({
        target: '0x1::option::some',
        typeArguments: ['0x2::allowance::RateLimit'],
        arguments: [
          tx.moveCall({
            target: '0x2::allowance::periodic_rate_limit',
            arguments: [tx.pure.u64(rateLimit.periodMs), tx.pure.u256(rateLimit.limit)],
          }),
        ],
      })
    : tx.moveCall({ target: '0x1::option::none', typeArguments: ['0x2::allowance::RateLimit'] });
  return tx.moveCall({
    target: '0x2::allowance::propose_for_app',
    typeArguments: [`0x2::balance::Balance<${coin}>`, typesOf(d).app],
    arguments: [
      tx.pure.string(name),
      tx.pure.address(d.executor),
      tx.pure.option('u256', cap),
      tx.pure.option('u64', null),
      tx.pure.option('u64', expiresAtMs),
      rl,
    ],
  });
}

/** Maker: app-bound allowance over base inventory. Funds do not move. */
export function issueMakerAllowance(
  p: { cap: bigint; expiresAtMs: number; rateLimit?: RateLimit },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const base = typesOf(d).base;
  const proposal = propose(tx, d, base, 'suijin maker inventory', p.cap, p.expiresAtMs, p.rateLimit);
  tx.moveCall({
    target: `${d.packageId}::app::issue_maker_allowance`,
    typeArguments: [base],
    arguments: [tx.object(d.configId), proposal],
  });
  return tx;
}

export function createFixedStrategy(
  p: { allowanceId: string; priceNum: bigint; priceDen: bigint; maxBasePerFill: bigint; virtualBaseLimit: bigint; expiresAtMs: number },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::create_fixed`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(p.allowanceId),
      tx.pure.u64(p.priceNum),
      tx.pure.u64(p.priceDen),
      tx.pure.u64(p.maxBasePerFill),
      tx.pure.u64(p.virtualBaseLimit),
      tx.pure.u64(p.expiresAtMs),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function createCurveStrategy(
  p: { allowanceId: string; virtualBase: bigint; virtualQuote: bigint; feeBps: bigint; maxBasePerFill: bigint; virtualBaseLimit: bigint; expiresAtMs: number },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::create_curve`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(p.allowanceId),
      tx.pure.u64(p.virtualBase),
      tx.pure.u64(p.virtualQuote),
      tx.pure.u64(p.feeBps),
      tx.pure.u64(p.maxBasePerFill),
      tx.pure.u64(p.virtualBaseLimit),
      tx.pure.u64(p.expiresAtMs),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function setStrategyActive(strategyId: string, active: boolean, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::set_active`,
    typeArguments: [t.base, t.quote],
    arguments: [tx.object(strategyId), tx.pure.bool(active)],
  });
  return tx;
}

/** Taker: exact-cap payment allowance + SwapOrder in ONE transaction. Funds do not move. */
export function createTakerOrder(
  p: { strategyId: string; quoteIn: bigint; minBaseOut: bigint; quotedBaseOut: bigint; expiresAtMs: number; recipient: string },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  const proposal = propose(tx, d, t.quote, 'suijin order payment', p.quoteIn, p.expiresAtMs);
  tx.moveCall({
    target: `${d.packageId}::order::create`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(d.configId),
      proposal,
      tx.pure.id(p.strategyId),
      tx.pure.u64(p.quoteIn),
      tx.pure.u64(p.minBaseOut),
      tx.pure.u64(p.quotedBaseOut),
      tx.pure.u64(p.expiresAtMs),
      tx.pure.address(p.recipient),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function cancelOrder(orderId: string, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({ target: `${d.packageId}::order::cancel`, typeArguments: [t.base, t.quote], arguments: [tx.object(orderId)] });
  return tx;
}

/** Funder: deletes the allowance; every later fill against it fails. */
export function revokeAllowance(p: { coin: string; allowanceId: string; capId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: '0x2::allowance::revoke',
    typeArguments: [`0x2::balance::Balance<${p.coin}>`],
    arguments: [tx.object(p.capId), tx.object(p.allowanceId)],
  });
  return tx;
}

/** Mint demo coins into the sender's address balance. */
export function mintTestCoin(which: 'tusd' | 'tjpy', amount: bigint, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${d.mockCoinsPackageId}::${which}::mint`,
    arguments: [tx.object(which === 'tusd' ? d.tusdFaucetId : d.tjpyFaucetId), tx.pure.u64(amount)],
  });
  return tx;
}

export type FillParams = {
  strategyId: string;
  orderId: string;
  maker: string;
  makerAllowanceId: string;
  taker: string;
  takerAllowanceId: string;
  baseOut: bigint;
  quoteIn: bigint;
};

/** Executor: one PTB that pulls both sides through their allowances and swaps them. */
export function buildFill(p: FillParams, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.setSender(d.executor);
  tx.moveCall({
    target: `${d.packageId}::settlement::fill`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(d.configId),
      tx.object(p.strategyId),
      tx.object(p.orderId),
      tx.object(p.makerAllowanceId),
      tx.withdrawal({ amount: p.baseOut, type: t.base, from: 'allowance', allowance: p.makerAllowanceId, funder: p.maker }),
      tx.object(p.takerAllowanceId),
      tx.withdrawal({ amount: p.quoteIn, type: t.quote, from: 'allowance', allowance: p.takerAllowanceId, funder: p.taker }),
      tx.object.clock(),
    ],
  });
  return tx;
}
