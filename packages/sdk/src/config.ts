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

const SUI_ICON =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Ccircle%20cx%3D%2216%22%20cy%3D%2216%22%20r%3D%2216%22%20fill%3D%22%234DA2FF%22%2F%3E%3Cg%20transform%3D%22translate%286.4%205.6%29%20scale%280.8%29%22%3E%3Cpath%20fill%3D%22%23fff%22%20d%3D%22M17.636%2010.009a7.16%207.16%200%200%201%201.565%204.474%207.2%207.2%200%200%201-1.608%204.53l-.087.106-.023-.135a7%207%200%200%200-.07-.349c-.502-2.21-2.142-4.106-4.84-5.642-1.823-1.034-2.866-2.278-3.14-3.693-.177-.915-.046-1.834.209-2.62.254-.787.631-1.446.953-1.843l1.05-1.284a.46.46%200%200%201%20.713%200l5.28%206.456zm1.66-1.283L12.26.123a.336.336%200%200%200-.52%200L4.704%208.726l-.023.029a9.33%209.33%200%200%200-2.07%205.872C2.612%2019.803%206.816%2024%2012%2024s9.388-4.197%209.388-9.373a9.32%209.32%200%200%200-2.07-5.871zM6.389%209.981l.63-.77.018.142q.023.17.055.34c.408%202.136%201.862%203.917%204.294%205.297%202.114%201.203%203.345%202.586%203.7%204.103a5.3%205.3%200%200%201%20.109%201.801l-.004.034-.03.014A7.2%207.2%200%200%201%2012%2021.67c-3.976%200-7.2-3.218-7.2-7.188%200-1.705.594-3.27%201.587-4.503z%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E';

/** Real testnet tokens anyone can trade against. Add a line here to list another one. */
const TESTNET_TOKENS: CoinInfo[] = [
  // SUI's on-chain metadata has no icon: the Sui drop, inline so it never depends on a third-party host.
  { key: 'SUI', type: '0x2::sui::SUI', symbol: 'SUI', name: 'Sui', decimals: 9, quoteRank: 1, iconUrl: SUI_ICON },
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
