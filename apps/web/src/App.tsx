import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { DEPLOYMENT } from '@suijin/sdk';
import { useState } from 'react';
import { Maker } from './Maker';
import { Trade } from './Trade';

export function App() {
  const [tab, setTab] = useState<'maker' | 'trade'>('maker');
  return (
    <main>
      <header>
        <a className="brand" href="https://suijin.xfajarr-web3.workers.dev">
          <img src="/logo.png" alt="" />
          <span>
            Suijin
          </span>
        </a>
        <ConnectButton />
      </header>
      <nav aria-label="Role">
        <button className={tab === 'maker' ? 'active' : ''} onClick={() => setTab('maker')}>Maker</button>
        <button className={tab === 'trade' ? 'active' : ''} onClick={() => setTab('trade')}>Trade</button>
      </nav>
      {tab === 'maker' ? <Maker /> : <Trade />}
      <footer className="muted">
      </footer>
    </main>
  );
}
