import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DEPLOYMENT, GRPC_URL } from '@suijin/sdk';
import { createApp } from './app';

// Local server: `bun run server`. The deployed one is worker.ts (Cloudflare) with the same routes.
const secret = process.env.EXECUTOR_SECRET_KEY;
if (!secret) throw new Error('EXECUTOR_SECRET_KEY missing. Get it with: sui keytool export --key-identity executor');
const signer = Ed25519Keypair.fromSecretKey(secret);
if (signer.toSuiAddress() !== DEPLOYMENT.executor) {
  throw new Error(`executor key ${signer.toSuiAddress()} does not match deployment executor ${DEPLOYMENT.executor}`);
}
const client = new SuiGrpcClient({ network: DEPLOYMENT.network, baseUrl: GRPC_URL() });

const server = Bun.serve({ port: Number(process.env.PORT ?? 8790), fetch: createApp(client, signer) });

console.log(`suijin server on ${server.url} (${DEPLOYMENT.network}, executor ${DEPLOYMENT.executor})`);
