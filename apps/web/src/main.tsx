import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css'; // base styles first, so page stylesheets can refine them
import { App } from './App';
import { dAppKit } from './dapp-kit';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </StrictMode>,
);
