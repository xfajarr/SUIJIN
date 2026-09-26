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
