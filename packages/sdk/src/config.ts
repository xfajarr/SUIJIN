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

/** The demo coins' decimals. Every other token carries its own in the registry. */
export const DECIMALS = 6;

/** A registry key: the token's symbol ('tUSD', 'SUI', 'USDC', …). */
export type CoinKey = string;
export type CoinInfo = {
  key: CoinKey;
  type: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Logo URL; tokens without one get a lettered badge. */
  iconUrl?: string;
  /**
   * Pricing side: a pair reads "1 <lower> = x <higher>", like 1 SUI = 3.2 USDC or 1 tUSD = 150 tJPY.
   * Unknown tokens default to 0, so they are priced in whatever they pair with.
   */
  quoteRank?: number;
  /** Mock coins only: the shared Faucet that mints them. */
  faucet?: { module: 'tjpy' | 'tusd'; id: string };
};

/** Real testnet tokens anyone can trade against. Add a line here to list another one. */
const TESTNET_TOKENS: CoinInfo[] = [
  { key: 'SUI', type: '0x2::sui::SUI', symbol: 'SUI', name: 'Sui', decimals: 9, quoteRank: 1 },
  {
    key: 'USDC',
    type: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    symbol: 'USDC',
    name: 'USDC',
    decimals: 6,
    iconUrl: 'https://www.circle.com/hubfs/Brand/USDC/USDC_icon_32x32.png',
    quoteRank: 2,
  },
  {
    key: 'DEEP',
    type: '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP',
    symbol: 'DEEP',
    name: 'DeepBook Token',
    decimals: 6,
    iconUrl: 'https://images.deepbook.tech/icon.svg',
  },
];

/** The two mock coins this deployment publishes, typed for code that needs exactly them (faucet, smoke tests). */
export const demoCoinsOf = (d: Deployment = DEPLOYMENT) => ({
  tUSD: { key: 'tUSD', type: `${d.mockCoinsPackageId}::tusd::TUSD`, symbol: 'tUSD', name: 'Test Dollar', decimals: 6, quoteRank: 2, faucet: { module: 'tusd', id: d.tusdFaucetId } } as CoinInfo,
  tJPY: { key: 'tJPY', type: `${d.mockCoinsPackageId}::tjpy::TJPY`, symbol: 'tJPY', name: 'Test Yen', decimals: 6, quoteRank: 3, faucet: { module: 'tjpy', id: d.tjpyFaucetId } } as CoinInfo,
});

/** Every listed token for a deployment: the two demo coins first, then real testnet tokens. */
export const tokensOf = (d: Deployment = DEPLOYMENT): CoinInfo[] => [
  ...Object.values(demoCoinsOf(d)),
  ...(d.network === 'testnet' ? TESTNET_TOKENS : []),
];

export const coinsOf = (d: Deployment = DEPLOYMENT): Record<CoinKey, CoinInfo> => Object.fromEntries(tokensOf(d).map((t) => [t.key, t]));

/** Orders a pair for display: "1 unit = price priced". Ties keep the given order. */
export const orient = (a: CoinInfo, b: CoinInfo) => ((b.quoteRank ?? 0) >= (a.quoteRank ?? 0) ? { unit: a, priced: b } : { unit: b, priced: a });

/** Pads every address in a Move type, so `0x2::sui::SUI` equals `0x000…002::sui::SUI`. */
export const normalizeType = (t: string) =>
  t.replace(/0x([0-9a-fA-F]+)/g, (_m, hex: string) => `0x${hex.toLowerCase().padStart(64, '0')}`);
export const sameType = (a: string, b: string) => normalizeType(a) === normalizeType(b);
export const coinByType = (type: string, d: Deployment = DEPLOYMENT) => tokensOf(d).find((c) => sameType(c.type, type));
/** A registry key ('tJPY', 'SUI', …) or a listed coin type. */
export const resolveCoin = (keyOrType: string, d: Deployment = DEPLOYMENT): CoinInfo | undefined =>
  coinsOf(d)[keyOrType as CoinKey] ?? coinByType(keyOrType, d);

/** A market direction: providers sell `base` and receive `quote`. */
export type Pair = { base: string; quote: string };
/** The original market: providers sell tJPY for tUSD. */
export const defaultPair = (d: Deployment = DEPLOYMENT): Pair => ({ base: typesOf(d).base, quote: typesOf(d).quote });
