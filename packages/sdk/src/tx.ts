import { Transaction, coinWithBalance, type TransactionResult } from '@mysten/sui/transactions';
import { DEPLOYMENT, defaultPair, typesOf, type Deployment, type Pair } from './config';

// Every builder returns an unsigned Transaction. `pair` defaults to the original market
// (providers sell tJPY for tUSD); pass { base: tUSD, quote: tJPY } for the other side.

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

export type AllowanceParams = { coin?: string; cap: bigint; expiresAtMs: number; rateLimit?: RateLimit };

function addAllowance(tx: Transaction, d: Deployment, p: AllowanceParams) {
  const coin = p.coin ?? typesOf(d).base;
  const proposal = propose(tx, d, coin, 'suijin liquidity budget', p.cap, p.expiresAtMs, p.rateLimit);
  tx.moveCall({
    target: `${d.packageId}::app::issue_maker_allowance`,
    typeArguments: [coin],
    arguments: [tx.object(d.configId), proposal],
  });
}

/** Provider: app-bound allowance (a "liquidity budget") over one coin, tJPY by default. Funds do not move. */
export function issueMakerAllowance(p: AllowanceParams, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  addAllowance(tx, d, p);
  return tx;
}

/** Provider: several allowances in ONE transaction, e.g. both sides of a pair. */
export function issueAllowances(list: AllowanceParams[], d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  for (const p of list) addAllowance(tx, d, p);
  return tx;
}

export type FixedParams = {
  allowanceId: string;
  priceNum: bigint;
  priceDen: bigint;
  maxBasePerFill: bigint;
  virtualBaseLimit: bigint;
  expiresAtMs: number;
  pair?: Pair;
};

export type CurveParams = {
  allowanceId: string;
  virtualBase: bigint;
  virtualQuote: bigint;
  feeBps: bigint;
  maxBasePerFill: bigint;
  virtualBaseLimit: bigint;
  expiresAtMs: number;
  pair?: Pair;
};

function addFixed(tx: Transaction, d: Deployment, p: FixedParams) {
  const pair = p.pair ?? defaultPair(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::create_fixed`,
    typeArguments: [pair.base, pair.quote],
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
}

function addCurve(tx: Transaction, d: Deployment, p: CurveParams) {
  const pair = p.pair ?? defaultPair(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::create_curve`,
    typeArguments: [pair.base, pair.quote],
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
}

export function createFixedStrategy(p: FixedParams, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  addFixed(tx, d, p);
  return tx;
}

export function createCurveStrategy(p: CurveParams, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  addCurve(tx, d, p);
  return tx;
}

export type StrategySpec = ({ kind: 'fixed' } & FixedParams) | ({ kind: 'curve' } & CurveParams);

/** Several strategies in ONE transaction, e.g. a two-sided liquidity position. */
export function createStrategies(list: StrategySpec[], d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  for (const s of list) {
    if (s.kind === 'fixed') addFixed(tx, d, s);
    else addCurve(tx, d, s);
  }
  return tx;
}

export function setStrategyActive(strategyId: string, active: boolean, pair?: Pair, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const { base, quote } = pair ?? defaultPair(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::set_active`,
    typeArguments: [base, quote],
    arguments: [tx.object(strategyId), tx.pure.bool(active)],
  });
  return tx;
}

/** Trader: exact-cap payment allowance + SwapOrder in ONE transaction. Funds do not move. */
export function createTakerOrder(
  p: { strategyId: string; quoteIn: bigint; minBaseOut: bigint; quotedBaseOut: bigint; expiresAtMs: number; recipient: string; pair?: Pair },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const { base, quote } = p.pair ?? defaultPair(d);
  const proposal = propose(tx, d, quote, 'suijin order payment', p.quoteIn, p.expiresAtMs);
  tx.moveCall({
    target: `${d.packageId}::order::create`,
    typeArguments: [base, quote],
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

export function cancelOrder(orderId: string, pair?: Pair, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const { base, quote } = pair ?? defaultPair(d);
  tx.moveCall({ target: `${d.packageId}::order::cancel`, typeArguments: [base, quote], arguments: [tx.object(orderId)] });
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

/** Mint both demo coins in ONE transaction. */
export function mintTestCoins(amounts: { tusd?: bigint; tjpy?: bigint }, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  for (const which of ['tusd', 'tjpy'] as const) {
    const amount = amounts[which];
    if (!amount) continue;
    tx.moveCall({
      target: `${d.mockCoinsPackageId}::${which}::mint`,
      arguments: [tx.object(which === 'tusd' ? d.tusdFaucetId : d.tjpyFaucetId), tx.pure.u64(amount)],
    });
  }
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
  pair?: Pair;
};

/** Executor: one PTB that pulls both sides through their allowances and swaps them. */
export function buildFill(p: FillParams, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const { base, quote } = p.pair ?? defaultPair(d);
  tx.setSender(d.executor);
  tx.moveCall({
    target: `${d.packageId}::settlement::fill`,
    typeArguments: [base, quote],
    arguments: [
      tx.object(d.configId),
      tx.object(p.strategyId),
      tx.object(p.orderId),
      tx.object(p.makerAllowanceId),
      tx.withdrawal({ amount: p.baseOut, type: base, from: 'allowance', allowance: p.makerAllowanceId, funder: p.maker }),
      tx.object(p.takerAllowanceId),
      tx.withdrawal({ amount: p.quoteIn, type: quote, from: 'allowance', allowance: p.takerAllowanceId, funder: p.taker }),
      tx.object.clock(),
    ],
  });
  return tx;
}

/**
 * Moves `amount` of a coin held as Coin objects into the owner's own address balance, the only
 * place Allowances can spend from. Nothing leaves the owner; SUI is split from the gas coin.
 */
export function depositToBalance(p: { coinType: string; amount: bigint; owner: string }): Transaction {
  const tx = new Transaction();
  tx.setSender(p.owner);
  tx.moveCall({ target: '0x2::coin::send_funds', typeArguments: [p.coinType], arguments: [coinWithBalance({ type: p.coinType, balance: p.amount }), tx.pure.address(p.owner)] });
  return tx;
}
