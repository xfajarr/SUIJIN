import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DEPLOYMENT, GRPC_URL } from '@suijin/sdk';
import { createApp } from './app';

// Cloudflare Worker entry: `bunx wrangler deploy` from apps/server. The executor key is a Worker
// secret (`wrangler secret put EXECUTOR_SECRET_KEY`), never part of the bundle.
type Env = { EXECUTOR_SECRET_KEY?: string };

// One client and signer per isolate, reused across requests.
let app: ReturnType<typeof createApp> | undefined;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!app) {
      if (!env.EXECUTOR_SECRET_KEY) return new Response('EXECUTOR_SECRET_KEY is not set', { status: 500 });
      const signer = Ed25519Keypair.fromSecretKey(env.EXECUTOR_SECRET_KEY);
      if (signer.toSuiAddress() !== DEPLOYMENT.executor) return new Response('executor key does not match the deployment', { status: 500 });
      app = createApp(new SuiGrpcClient({ network: DEPLOYMENT.network, baseUrl: GRPC_URL() }), signer);
    }
    return app(req);
  },
};
