import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectButton, ConnectModal } from '@mysten/dapp-kit-react/ui';
import { DEPLOYMENT, mintTestCoins } from '@suijin/sdk';
import { useEffect, useState, type ComponentType } from 'react';
import { SERVER, connectModal, explorer, fetchHealth, useAction, useBalances, usePoll } from './chain';
import { Earn } from './pages/Earn';
import { Limit } from './pages/Limit';
import { Pay } from './pages/Pay';
import { Portfolio } from './pages/Portfolio';
import { Swap } from './pages/Swap';
import { Toasts, short } from './ui';

const PAGES: { path: string; label: string; Page: ComponentType }[] = [
  { path: 'swap', label: 'Swap', Page: Swap },
  { path: 'pay', label: 'Pay', Page: Pay },
  { path: 'earn', label: 'Earn', Page: Earn },
  { path: 'limit', label: 'Limit', Page: Limit },
  { path: 'portfolio', label: 'Portfolio', Page: Portfolio },
];

/** '#/pay?to=…' -> 'pay'. Pages read their own query params. */
const currentPath = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'swap';

export function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const { Page } = PAGES.find((p) => p.path === path) ?? PAGES[0]!;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="https://suijin.xfajarr-web3.workers.dev" aria-label="Suijin home">
          <img src="/logo.png" alt="" />
          <span>Suijin</span>
        </a>
        <nav className="nav" aria-label="Main">
          {PAGES.map((p) => (
            <a key={p.path} href={`#/${p.path}`} aria-current={p.path === path ? 'page' : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="net">Testnet</span>
          <Faucet />
          <ConnectButton />
        </div>
      </header>
      <main key={path}>
        <Page />
      </main>
      <Status />
      <ConnectModal ref={connectModal as never} />
      <Toasts />
    </div>
  );
}

/** Test tokens in one click; points to the SUI faucet first when there is no gas. */
function Faucet() {
  const account = useCurrentAccount();
  const balances = useBalances();
  const { act, busy } = useAction();
  if (!account) return null;
  if (balances.value?.sui === 0n) {
    return (
      <a className="btn ghost sm" href={`https://faucet.sui.io/?address=${account.address}`} target="_blank" rel="noreferrer" title="Get testnet SUI for gas">
        Get SUI ↗
      </a>
    );
  }
  return (
    <button
      type="button"
      className="btn ghost sm"
      disabled={!!busy}
      title="Mint 1,000 tUSD and 150,000 tJPY to your wallet"
      onClick={() =>
        act('Minting test tokens', () => mintTestCoins({ tusd: 1_000_000_000n, tjpy: 150_000_000_000n }), {
          done: 'Added 1,000 tUSD and 150,000 tJPY',
        })
      }
    >
      {busy ? 'Minting…' : 'Faucet'}
    </button>
  );
}

function Status() {
  const health = usePoll(fetchHealth, [], 15_000);
  const online = health.value?.ok === true;
  const outdated = online && health.value!.outdated;
  return (
    <footer className="footnote inline" style={{ justifyContent: 'center' }}>
      <span className={`chip ${outdated ? 'gold' : online ? 'accent' : health.error ? 'danger' : ''}`} title={SERVER}>
        <span className={`dot${online ? ' live' : ''}`} />
        {outdated ? 'Executor outdated' : online ? 'Executor online' : health.error ? 'Executor offline' : 'Checking executor…'}
      </span>
      {(health.error || outdated) && <span>{outdated ? 'Restart it: bun run server' : 'Start it with bun run server'}</span>}
      <span>
        Contracts{' '}
        <a href={explorer.object(DEPLOYMENT.packageId)} target="_blank" rel="noreferrer">
          {short(DEPLOYMENT.packageId)}
        </a>
      </span>
      <span>Sui {DEPLOYMENT.network}</span>
    </footer>
  );
}
