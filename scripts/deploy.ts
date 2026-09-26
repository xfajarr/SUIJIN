// Publish mock_coins + suijin with the EXECUTOR key (the publisher becomes the executor).
// Usage: EXECUTOR_SECRET_KEY=suiprivkey... bun scripts/deploy.ts [testnet|devnet]
import { $ } from 'bun';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { Deployment } from '@suijin/sdk';

const ROOT = new URL('..', import.meta.url).pathname;
const SUI = process.env.SUI_BIN ?? 'sui';

async function publish(client: SuiGrpcClient, signer: Ed25519Keypair, dir: string) {
  const out = await $`${SUI} move build --dump-bytecode-as-base64 --path ${ROOT}contracts/${dir}`.quiet().text();
  const { modules, dependencies } = JSON.parse(out.slice(out.indexOf('{')));
  const tx = new Transaction();
  tx.transferObjects([tx.publish({ modules, dependencies })], signer.toSuiAddress());
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
  if (r.$kind === 'FailedTransaction') throw new Error(`publish ${dir}: ${r.FailedTransaction.status.error?.message}`);
  await client.waitForTransaction({ result: r });
  const changed = r.Transaction.effects.changedObjects;
  const types = r.Transaction.objectTypes;
  const packageId = changed.find((c) => c.outputState === 'PackageWrite')?.objectId;
  if (!packageId) throw new Error(`publish ${dir}: no package in effects`);
  const created = (suffix: string) => {
    const hit = changed.find((c) => c.idOperation === 'Created' && types[c.objectId]?.endsWith(suffix));
    if (!hit) throw new Error(`publish ${dir}: no created ${suffix}`);
    return hit.objectId;
  };
  console.log(`published ${dir}: ${packageId} (${r.Transaction.digest})`);
  return { packageId, created };
}

/**
 * Currencies created in `init` wait at the registry address (0xc) until finalize_registration
 * makes them shared. Without it explorers and GraphQL cannot see the decimals.
 */
async function finalizeCurrencies(client: SuiGrpcClient, signer: Ed25519Keypair, coinTypes: string[], currencyIds: string[]) {
  const tx = new Transaction();
  coinTypes.forEach((coinType, i) =>
    tx.moveCall({ target: '0x2::coin_registry::finalize_registration', typeArguments: [coinType], arguments: [tx.object('0xc'), tx.object(currencyIds[i]!)] }),
  );
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } });
  if (r.$kind === 'FailedTransaction') throw new Error(`finalize currencies: ${r.FailedTransaction.status.error?.message}`);
  await client.waitForTransaction({ result: r });
  console.log(`finalized coin registry entries (${r.Transaction.digest})`);
}

export async function deploy(signer: Ed25519Keypair, network: Deployment['network']): Promise<Deployment> {
  const client = new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` });
  const coins = await publish(client, signer, 'mock_coins');
  await finalizeCurrencies(
    client,
    signer,
    [`${coins.packageId}::tjpy::TJPY`, `${coins.packageId}::tusd::TUSD`],
    [coins.created('::tjpy::TJPY>'), coins.created('::tusd::TUSD>')],
  );
  const core = await publish(client, signer, 'suijin');
  return {
    network,
    packageId: core.packageId,
    configId: core.created('::app::ProtocolConfig'),
    executor: signer.toSuiAddress(),
    mockCoinsPackageId: coins.packageId,
    tusdFaucetId: coins.created('::tusd::Faucet'),
    tjpyFaucetId: coins.created('::tjpy::Faucet'),
  };
}

if (import.meta.main) {
  const network = (process.argv[2] ?? 'testnet') as Deployment['network'];
  const secret = process.env.EXECUTOR_SECRET_KEY;
  if (!secret) throw new Error('EXECUTOR_SECRET_KEY missing');
  const d = await deploy(Ed25519Keypair.fromSecretKey(secret), network);
  await Bun.write(`${ROOT}packages/sdk/src/deployment.json`, `${JSON.stringify(d, null, 2)}\n`);
  console.log('wrote packages/sdk/src/deployment.json', d);
}
