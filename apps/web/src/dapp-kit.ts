import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { DEPLOYMENT, GRPC_URL } from '@suijin/sdk';

export const dAppKit = createDAppKit({
  // VITE_BURNER=1 bun run dev: an in-browser test wallet, for rehearsing the demo without an extension.
  enableBurnerWallet: import.meta.env.VITE_BURNER === '1',
  networks: [DEPLOYMENT.network],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URL() }),
});

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
