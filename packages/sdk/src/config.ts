import deployment from './deployment.json' with { type: 'json' };

export type Deployment = {
  network: 'testnet' | 'devnet';
  packageId: string;
  configId: string;
  executor: string;
  mockCoinsPackageId: string;
  tusdFaucetId: string;
  tjpyFaucetId: string;
};

export const DEPLOYMENT = deployment as Deployment;

export const GRPC_URL = (d: Deployment = DEPLOYMENT) => `https://fullnode.${d.network}.sui.io:443`;
export const GRAPHQL_URL = (d: Deployment = DEPLOYMENT) => `https://graphql.${d.network}.sui.io/graphql`;

/** Fully qualified Move types for this deployment. Base = what makers sell, Quote = what takers pay. */
export const typesOf = (d: Deployment = DEPLOYMENT) => ({
  app: `${d.packageId}::app::App`,
  base: `${d.mockCoinsPackageId}::tjpy::TJPY`,
  quote: `${d.mockCoinsPackageId}::tusd::TUSD`,
  strategy: `${d.packageId}::strategy::Strategy`,
  order: `${d.packageId}::order::SwapOrder`,
  allowance: '0x2::allowance::Allowance',
  allowanceCap: (coin: string) => `0x2::allowance::AllowanceCap<0x2::balance::Balance<${coin}>>`,
});

/** Both demo coins use 6 decimals. */
export const DECIMALS = 6;

export type CoinKey = 'tJPY' | 'tUSD';
export type CoinInfo = {
  key: CoinKey;
  type: string;
  symbol: string;
  name: string;
  decimals: number;
  faucet: 'tjpy' | 'tusd';
  faucetId: string;
};

export const coinsOf = (d: Deployment = DEPLOYMENT): Record<CoinKey, CoinInfo> => ({
  tJPY: { key: 'tJPY', type: `${d.mockCoinsPackageId}::tjpy::TJPY`, symbol: 'tJPY', name: 'Test Yen', decimals: 6, faucet: 'tjpy', faucetId: d.tjpyFaucetId },
  tUSD: { key: 'tUSD', type: `${d.mockCoinsPackageId}::tusd::TUSD`, symbol: 'tUSD', name: 'Test Dollar', decimals: 6, faucet: 'tusd', faucetId: d.tusdFaucetId },
});

/** Pads every address in a Move type, so `0x2::sui::SUI` equals `0x000…002::sui::SUI`. */
export const normalizeType = (t: string) =>
  t.replace(/0x([0-9a-fA-F]+)/g, (_m, hex: string) => `0x${hex.toLowerCase().padStart(64, '0')}`);
export const sameType = (a: string, b: string) => normalizeType(a) === normalizeType(b);
export const coinByType = (type: string, d: Deployment = DEPLOYMENT) => Object.values(coinsOf(d)).find((c) => sameType(c.type, type));
/** 'tJPY' / 'tUSD' or a full coin type. */
export const resolveCoin = (keyOrType: string, d: Deployment = DEPLOYMENT): CoinInfo | undefined =>
  coinsOf(d)[keyOrType as CoinKey] ?? coinByType(keyOrType, d);

/** A market direction: providers sell `base` and receive `quote`. */
export type Pair = { base: string; quote: string };
/** The original market: providers sell tJPY for tUSD. */
export const defaultPair = (d: Deployment = DEPLOYMENT): Pair => ({ base: typesOf(d).base, quote: typesOf(d).quote });
