import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectButton, ConnectModal } from '@mysten/dapp-kit-react/ui';
import { DEPLOYMENT, mintTestCoins } from '@suijin/sdk';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { SERVER, connectModal, explorer, fetchHealth, useAction, useBalances, usePoll } from './chain';
import { Earn } from './pages/Earn';
import { Limit } from './pages/Limit';
import { Pay } from './pages/Pay';
import { Portfolio } from './pages/Portfolio';
import { Swap } from './pages/Swap';
import { Toasts, short } from './ui';

const PAGES: { path: string; Page: ComponentType }[] = [
  { path: 'swap', Page: Swap },
  { path: 'pay', Page: Pay },
  { path: 'earn', Page: Earn },
  { path: 'limit', Page: Limit },
  { path: 'portfolio', Page: Portfolio },
];

/** Navbar: Swap, Pay and Limit live under one Trade card with its own tabs. */
const NAV = [
  { href: '#/swap', label: 'Trade', paths: ['swap', 'pay', 'limit'] },
  { href: '#/earn', label: 'Earn', paths: ['earn'] },
  { href: '#/portfolio', label: 'Portfolio', paths: ['portfolio'] },
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
  const page = PAGES.find((p) => p.path === path) ?? PAGES[0]!;

  return (
    <>
      <Header current={page.path} />
      <div className="app">
        <main key={page.path}>
          <page.Page />
        </main>
        <Status />
      </div>
      <ConnectModal ref={connectModal as never} />
      <Toasts />
    </>
  );
}

/** Full width and transparent at the top; once the page scrolls it stays pinned with a backdrop. */
function Header({ current }: { current: string }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
      <a className="brand" href="https://suijin.xfajarr-web3.workers.dev" aria-label="Suijin home">
        <img src="/icon.png" alt="" />
        <span>Suijin</span>
      </a>
      <Nav current={current} />
      <div className="topbar-actions">
        <Faucet />
        <ConnectButton />
      </div>
    </header>
  );
}

/** Page tabs with one pill that slides to the current page. */
function Nav({ current }: { current: string }) {
  const ref = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ x: 0, w: 0, animate: false });
  const place = (animate: boolean) => {
    const a = ref.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (a) setPill({ x: a.offsetLeft, w: a.offsetWidth, animate });
    return a;
  };
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const a = place(mounted.current);
    if (mounted.current) a?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // phones: keep the tab in view
    mounted.current = true;
  }, [NAV.find((n) => n.paths.includes(current))?.label]);
  useEffect(() => {
    // Web fonts and resizes change tab widths: re-measure without animating.
    const settle = () => place(false);
    void document.fonts?.ready.then(settle);
    window.addEventListener('resize', settle);
    return () => window.removeEventListener('resize', settle);
  }, []);
  return (
    <nav className="nav" aria-label="Main" ref={ref}>
      <span className={`nav-pill${pill.animate ? ' animate' : ''}`} style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} aria-hidden="true" />
      {NAV.map((n) => (
        <a key={n.label} href={n.href} aria-current={n.paths.includes(current) ? 'page' : undefined}>
          {n.label}
        </a>
      ))}
    </nav>
  );
}

const Drop = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.8S3.6 6.6 3.6 9.7a4.4 4.4 0 008.8 0C12.4 6.6 8 1.8 8 1.8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

/** Test tokens in one click; points to the SUI faucet first when there is no gas. */
function Faucet() {
  const account = useCurrentAccount();
  const balances = useBalances();
  const { act, busy } = useAction();
  if (!account) return null;
  if (balances.value?.sui === 0n) {
    return (
      <a className="tool" href={`https://faucet.sui.io/?address=${account.address}`} target="_blank" rel="noreferrer" title="Get testnet SUI for gas">
        <Drop />
        Get SUI
      </a>
    );
  }
  return (
    <button
      type="button"
      className="tool"
      disabled={!!busy}
      title="Mint 1,000 tUSD and 150,000 tJPY to your wallet"
      onClick={() =>
        act('Minting test tokens', () => mintTestCoins({ tusd: 1_000_000_000n, tjpy: 150_000_000_000n }), {
          done: 'Added 1,000 tUSD and 150,000 tJPY',
        })
      }
    >
      <Drop />
      {busy ? 'Minting…' : 'Faucet'}
    </button>
  );
}

function Status() {
  const health = usePoll(fetchHealth, [], 15_000);
  const online = health.value?.ok === true;
  const outdated = online && health.value!.outdated;
  return (
    <footer className="footnote">
      <span className={`status ${outdated ? 'gold' : online ? 'ok' : health.error ? 'bad' : ''}`} title={SERVER}>
        <span className="dot" />
        {outdated ? 'Executor outdated' : online ? 'Executor online' : health.error ? 'Executor offline' : 'Checking executor'}
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
