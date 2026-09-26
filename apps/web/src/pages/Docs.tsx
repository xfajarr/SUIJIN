import { DEPLOYMENT } from '@suijin/sdk';
import { useState, type ReactNode } from 'react';
import { explorer } from '../chain';
import { Segmented } from '../ui';
import './docs.css';

// Two audiences: Guide (plain language) and Technical (primitives, contracts, math, API). Static content, mirrors the code.

const SECTIONS = [
  ['overview', 'Overview'],
  ['architecture', 'Architecture'],
  ['sui', 'Sui primitives'],
  ['objects', 'On-chain objects'],
  ['flows', 'Flows'],
  ['math', 'Pricing math'],
  ['settlement', 'Settlement checks'],
  ['security', 'Security model'],
  ['limits', 'Limitations'],
  ['api', 'API'],
  ['sdk', 'SDK'],
  ['deployments', 'Deployments'],
] as const;

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section id={id} className="doc-section">
    <h2 className="doc-h2">{title}</h2>
    {children}
  </section>
);

const Code = ({ children }: { children: string }) => <pre className="doc-code">{children.trim()}</pre>;

const GUIDE_SECTIONS = [
  ['what', 'What is Suijin'],
  ['why', 'Why it is different'],
  ['earn', 'Earn'],
  ['swap', 'Swap'],
  ['pay', 'Pay'],
  ['limit', 'Limit'],
  ['portfolio', 'Portfolio'],
  ['safety', 'Is it safe?'],
  ['words', 'Words we use'],
  ['faq', 'FAQ'],
] as const;

// Plain-language docs: same facts as Technical, no code.
const Guide = () => (
  <article className="doc-body">
    <Section id="what" title="What is Suijin">
      <p>
        <b>Suijin lets you earn from your coins without depositing them anywhere.</b> Your coins stay in your own wallet. You give Suijin a
        limited permission to sell some of them at a price you choose, and traders buy from you. When a trade happens, the coins swap
        directly between your wallet and theirs.
      </p>
      <p>
        Think of it as leaving a signed, limited cheque with a trusted shop: it can only be used for this shop, only up to the amount you
        wrote, only until the date you set, and you can tear it up any time.
      </p>
    </Section>

    <Section id="why" title="Why it is different">
      <table className="doc-table">
        <thead>
          <tr><th></th><th>A usual liquidity pool</th><th>Suijin</th></tr>
        </thead>
        <tbody>
          <tr><td>Your coins</td><td>Sent into the pool</td><td><b>Stay in your wallet</b></td></tr>
          <tr><td>Markets</td><td>One deposit = one pool</td><td><b>One balance can back many markets</b></td></tr>
          <tr><td>Getting out</td><td>Withdraw from the pool</td><td><b>Revoke the permission; nothing to withdraw</b></td></tr>
          <tr><td>Your price</td><td>Set by the pool</td><td><b>You choose it</b></td></tr>
        </tbody>
      </table>
    </Section>

    <Section id="earn" title="Earn">
      <p>Offer your coins to traders and keep a small fee on every trade.</p>
      <ol>
        <li><b>Choose what you offer</b>: sell tJPY, sell tUSD, or both.</li>
        <li><b>Set your price</b>. "Use market" fills in the current rate. Pick <b>Fixed price</b> (one price for every trade) or <b>Curve</b> (your price rises as more of your coins sell).</li>
        <li><b>Pick your fee</b>. A lower fee gives traders a better price, so your market gets picked first. A higher fee earns more per trade, but less often.</li>
        <li><b>Set how much</b> you are willing to sell and for how long, then confirm in your wallet (two approvals).</li>
      </ol>
      <p>
        With Curve, <b>"Price moves"</b> sets how quickly your price rises: <b>Very fast</b> suits volatile pairs, <b>Slow</b> suits most pairs,
        and <b>Barely</b> is close to a fixed price.
      </p>
    </Section>

    <Section id="swap" title="Swap">
      <p>
        Trade any token for any other: tUSD, tJPY, SUI, USDC, DEEP, or any Sui coin you add by pasting its type. Suijin checks every market and shows the best price. You approve <b>exactly</b> the amount you pay, and
        that approval expires after five minutes. If the price moves more than your slippage setting, the trade does not happen and nothing
        leaves your wallet. A red button means the trade would move the price a lot: check before you continue.
      </p>
    </Section>

    <Section id="pay" title="Pay">
      <p>
        Pay someone an exact amount in the coin <b>they</b> want, using the coin <b>you</b> have. Enter their address and the amount they
        should receive; Suijin works out what it costs you. They are guaranteed to receive at least that amount, or the payment does not go
        through. Merchants can share a payment link that fills everything in.
      </p>
    </Section>

    <Section id="limit" title="Limit">
      <p>
        Sell at a price you choose and wait for a buyer. Your coins stay in your wallet until someone buys; they can buy part of it. You can
        pause or cancel at any time.
      </p>
    </Section>

    <Section id="portfolio" title="Portfolio">
      <ul>
        <li><b>Balances</b>: what is in your wallet.</li>
        <li><b>Positions</b>: your permissions (budgets), the markets using them, and what trades have paid you.</li>
        <li><b>Markets / Budgets / Activity</b>: pause a market, revoke a budget, and see every trade.</li>
      </ul>
    </Section>

    <Section id="safety" title="Is it safe?">
      <ul>
        <li><b>You never deposit.</b> Your coins stay in your wallet until a trade settles.</li>
        <li><b>The permission has limits</b>: a maximum amount, an end date, and it only works through Suijin's contract.</li>
        <li><b>You can revoke any time</b> from Portfolio.</li>
        <li><b>Nobody can change your price or send coins elsewhere.</b> The contract recalculates every trade and checks the amounts. If anything does not match, the whole trade is cancelled and nothing moves.</li>
        <li><b>Traders are protected too</b>: they get at least the minimum they agreed to, or nothing happens.</li>
      </ul>
      <p className="faint">Suijin runs on Sui testnet with test coins. It is hackathon code and has not been audited.</p>
    </Section>

    <Section id="words" title="Words we use">
      <table className="doc-table">
        <tbody>
          <tr><td>Budget</td><td>The limited permission you give: how much, until when.</td></tr>
          <tr><td>Market</td><td>One price offer that uses a budget. One budget can back several markets.</td></tr>
          <tr><td>Fill</td><td>A trade against your market.</td></tr>
          <tr><td>Spread</td><td>How far your price is from the rate you entered. This is where your fee comes from.</td></tr>
          <tr><td>Slippage</td><td>How much worse than the quote you accept before the trade is cancelled.</td></tr>
          <tr><td>Price impact</td><td>How much your own trade moves the price. Big trades on small markets move it more.</td></tr>
          <tr><td>Executor</td><td>The service that submits trades. It can only submit, never change them.</td></tr>
        </tbody>
      </table>
    </Section>

    <Section id="faq" title="FAQ">
      <h3>What if I spend my coins elsewhere?</h3>
      <p>Trades against your markets just stop working until your balance is back. Nothing is lost.</p>
      <h3>Why did my swap fail?</h3>
      <p>Usually the provider moved their coins, or the price moved past your slippage. Your coins never left your wallet; try again.</p>
      <h3>How do I stop earning?</h3>
      <p>Portfolio → Budgets → Revoke. Or pause a single market.</p>
      <h3>How do I get test coins?</h3>
      <p>Use the faucet button in the app after connecting a wallet on Sui testnet.</p>
    </Section>
  </article>
);

const Technical = () => (
  <article className="doc-body">
    <Section id="overview" title="Overview">
      <p>
        <b>Suijin lets one self-custodial wallet balance back many markets at once.</b> A provider grants a Sui Allowance (capped,
        expiring, revocable, and spendable only through Suijin's Move package) instead of depositing into a pool. Markets quote against
        that permission; coins move only when a trade settles, atomically, in one programmable transaction block (PTB).
      </p>
      <table className="doc-table">
        <tbody>
          <tr><td>Provider</td><td>Anyone offering liquidity from their wallet. <code>maker</code> in code.</td></tr>
          <tr><td>Trader</td><td>Anyone swapping or paying against that liquidity. <code>taker</code> in code.</td></tr>
          <tr><td>Budget</td><td>A provider's Allowance: "the executor may pull up to X of my coin, only through Suijin, until T".</td></tr>
          <tr><td>Market</td><td>A <code>Strategy</code> object: how one budget is priced (fixed or curve).</td></tr>
          <tr><td>Executor</td><td>The service that submits settlements. It chooses <i>when</i>, never <i>what</i>.</td></tr>
        </tbody>
      </table>
    </Section>

    <Section id="architecture" title="Architecture">
      <Code>{`
 Web app (Cloudflare Pages)        API (Cloudflare Worker)             Sui testnet
 React + dApp Kit                  quotes + executor                   package suijin
 ───────────────────────           ────────────────────────            ─────────────────────
 build & sign txs  ─────────────────────────────────────────────────►  app, strategy, order,
 POST /v1/quote    ──────────────► read markets (GraphQL, then          settlement, math
                             fresh from a fullnode over gRPC)
             ◄────────────── routes, best first
 POST /v1/orders/{id}/fill ─────►  re-check, sign one PTB ──────────►  settlement::fill
      `}</Code>
      <ul>
        <li><b>contracts/suijin</b>: Move. <code>app</code> (Allowance binding, the only spend path), <code>math</code>, <code>strategy</code>, <code>order</code>, <code>settlement</code>. 26 tests.</li>
        <li><b>packages/sdk</b>: TypeScript builders for every entry point, readers, the quote engine, and the Move math mirrored for off-chain pricing.</li>
        <li><b>apps/server</b>: one fetch handler (quotes + fills). Bun locally, a Cloudflare Worker in production with the executor key as a secret.</li>
        <li><b>apps/web</b>: React 19, Vite, <code>@mysten/dapp-kit-react</code>, on Cloudflare Pages.</li>
      </ul>
    </Section>

    <Section id="sui" title="Sui primitives">
      <table className="doc-table">
        <thead>
          <tr><th>Primitive</th><th>How Suijin uses it</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>App-bound Allowances</td>
            <td>
              <code>allowance::propose_for_app&lt;Balance&lt;C&gt;, App&gt;</code> then <code>issue</code> with a <code>SettingsPermit&lt;App&gt;</code>. Spending needs a
              <code> SpendPermit</code> minted by <code>internal::permit&lt;App&gt;()</code>, which only Suijin's own modules can call. Spender = the executor. Funders
              <code> revoke</code> any time. <code>rotate_spender</code> exists for a future executor rotation.
            </td>
          </tr>
          <tr><td>Address balances</td><td>Coins stay as plain wallet balances. Settlement withdraws with <code>tx.withdrawal(&#123; from: 'allowance' &#125;)</code> and delivers with <code>balance::send_funds</code>.</td></tr>
          <tr><td>PTBs</td><td>One fill = one PTB with two Allowance withdrawals. Two budgets or two markets are created in one PTB.</td></tr>
          <tr><td>Shared objects</td><td><code>Strategy</code>, <code>SwapOrder</code> and Allowances are shared, so the executor can settle any of them.</td></tr>
          <tr><td>Coin Registry</td><td>tUSD and tJPY use <code>coin_registry::new_currency_with_otw</code>; <code>finalize_registration</code> publishes their metadata (6 decimals).</td></tr>
          <tr><td>Any coin</td><td>Every Move entry point is generic over <code>&lt;Base, Quote&gt;</code>, so any Sui coin can be listed without a new deployment. The app keeps a token registry (symbol, decimals, logo from on-chain metadata) and converts prices across decimals, e.g. SUI (9) against USDC (6).</td></tr>
          <tr><td>gRPC + GraphQL</td><td>GraphQL for discovery and history (paginated). gRPC fullnode reads for anything that prices or settles, so quotes match what Move recomputes.</td></tr>
        </tbody>
      </table>
    </Section>

    <Section id="objects" title="On-chain objects">
      <Code>{`
Strategy<Base, Quote>            // a market; Base = what the provider sells
  maker, maker_allowance_id      // who, and which budget pays
  kind: 0 fixed | 1 curve
  price_num, price_den           // fixed: price_num Quote units buy price_den Base units
  virtual_base, virtual_quote    // curve: virtual reserves (x · y = k)
  fee_bps                        // curve fee, taken from the input
  max_base_per_fill, virtual_base_remaining, expiry_ms, active
  fill_count, base_filled, quote_received

SwapOrder<Base, Quote>           // a trader's intent
  taker, recipient, strategy_id
  quote_in                       // exact input, equal to the payment Allowance cap
  min_base_out, quoted_base_out, expiry_ms
  status: 0 open | 1 filled | 2 cancelled

ProtocolConfig { executor, paused }   events: StrategyCreated, OrderCreated, Fill
      `}</Code>
    </Section>

    <Section id="flows" title="Flows">
      <h3>Earn (provide liquidity)</h3>
      <ol>
        <li><b>Grant a budget</b>: <code>propose_for_app</code> + <code>app::issue_maker_allowance</code>. Checks: funder = sender, spender = executor, an expiry is set. No coins move.</li>
        <li><b>Open markets</b>: <code>strategy::create_fixed</code> or <code>create_curve</code> on that Allowance. A second transaction, because a shared object created in a PTB cannot be used later in the same PTB.</li>
        <li><b>Reuse a budget</b>: open another market on an existing Allowance (step 2 only). Every market draws on the same balance and cap: one balance, many markets.</li>
      </ol>
      <h3>Limit</h3>
      <p>One fixed-price market on its own budget (cap = order size). It fills whenever it is a trader's best route, partially allowed. Cancel revokes the budget; pause flips <code>active</code>.</p>
      <h3>Swap</h3>
      <ol>
        <li><b>Quote</b>: <code>POST /v1/quote</code>. Each route is capped by min(provider balance, budget left, market remaining, max per fill). Paused, expired or revoked markets are skipped.</li>
        <li><b>Order</b>: the trader signs <code>propose_for_app</code> (cap = exact <code>quote_in</code>, 5-minute expiry) + <code>order::create</code>. Nothing moves.</li>
        <li><b>Settle</b>: <code>POST /v1/orders/&#123;id&#125;/fill</code>; the executor submits <code>settlement::fill</code>. It pays this gas.</li>
      </ol>
      <h3>Pay</h3>
      <p>
        Swap with an exact output and a different recipient. The quote finds the cheapest input and adds the slippage buffer to it;
        <code> min_base_out</code> equals the target, so the recipient gets at least the requested amount. Request links:
        <code> #/pay?to=0x…&amp;amount=1500&amp;coin=tJPY</code>.
      </p>
      <h3>Portfolio</h3>
      <p>Reads the wallet's AllowanceCaps (budgets vs unspent payment approvals, told apart by name), its strategies, and <code>Fill</code> events. Actions: <code>strategy::set_active</code>, <code>allowance::revoke</code>.</p>
    </Section>

    <Section id="math" title="Pricing math">
      <p>All amounts are integers in 6-decimal units. Move (<code>math.move</code>) and TypeScript (<code>math.ts</code>) implement the same formulas with shared test vectors; everything runs in u128 and rounds in the provider's favour.</p>
      <h3>Fixed price</h3>
      <Code>{`base_out = floor(quote_in × price_den / price_num)`}</Code>
      <p>Earn bakes the fee tier into the price as a spread (P = tJPY per tUSD, f = fee in bps):</p>
      <Code>{`
sell tJPY:  price_num = 1e6 × 10000      price_den = P × (10000 − f)
sell tUSD:  price_num = P × (10000 + f)  price_den = 1e6 × 10000
      `}</Code>
      <h3>Curve (constant product on virtual reserves)</h3>
      <Code>{`
effective_in = quote_in × (10000 − fee_bps) / 10000
k            = virtual_base × virtual_quote
new_base     = ceil(k / (virtual_quote + effective_in))
base_out     = virtual_base − new_base
      `}</Code>
      <p>Earn sets <code>virtual_base = budget × m</code> and <code>virtual_quote</code> so the starting price equals P. The budget still caps what can sell (<code>virtual_base_remaining</code>), so m only changes how fast the price moves:</p>
      <table className="doc-table">
        <thead>
          <tr><th>"Price moves"</th><th>m</th><th>Move when all of it sells = (m / (m − 1))²</th></tr>
        </thead>
        <tbody>
          <tr><td>Very fast</td><td>1</td><td>unbounded (never fully sells)</td></tr>
          <tr><td>Fast</td><td>5</td><td>1.56× (56%)</td></tr>
          <tr><td>Slow</td><td>20</td><td>1.11× (11%)</td></tr>
          <tr><td>Barely</td><td>100</td><td>1.02× (2%)</td></tr>
        </tbody>
      </table>
      <h3>Quotes</h3>
      <Code>{`
exact input  (Swap): min_base_out = base_out × (1 − slippage)
exact output (Pay):  quote_in = ceil(needed × (1 + slippage)),  min_base_out = target
price impact:        ideal = quote_in × (1 − fee) × vb / vq,  impact = (ideal − out) / ideal
      `}</Code>
    </Section>

    <Section id="settlement" title="Settlement checks">
      <p><code>settlement::fill</code> derives every amount and recipient itself. Any failed check reverts the whole PTB, so nothing moves.</p>
      <ol className="doc-checks">
        <li>Protocol not paused; sender is <code>ProtocolConfig.executor</code>.</li>
        <li>The order belongs to this strategy, is open and not expired.</li>
        <li>The provider Allowance is the strategy's; the trader Allowance is funded by the order's taker with cap = <code>quote_in</code> and the same expiry.</li>
        <li><code>base_out = strategy.quote(quote_in)</code> is recomputed; the market is active, not expired, within max per fill and remaining size.</li>
        <li><code>base_out ≥ min_base_out</code> (slippage).</li>
        <li>Both Allowances are spent through the package-only permit, and the withdrawn amounts must equal <code>base_out</code> and <code>quote_in</code> exactly.</li>
        <li>Stats update, the order is marked filled, the quote coin goes to the provider and the base coin to the order's recipient, and a <code>Fill</code> event is emitted.</li>
      </ol>
    </Section>

    <Section id="security" title="Security model">
      <table className="doc-table">
        <thead>
          <tr><th>The executor can</th><th>The executor cannot</th></tr>
        </thead>
        <tbody>
          <tr><td>Delay or censor orders</td><td>Change a price or amount: Move recomputes both and checks the withdrawals exactly</td></tr>
          <tr><td>Choose the order of fills</td><td>Change a recipient: fixed in the strategy and the order</td></tr>
          <tr><td></td><td>Spend another way: only <code>suijin::app</code> mints the spend permit</td></tr>
          <tr><td></td><td>Exceed a cap, an expiry or a real balance: the Sui framework enforces these</td></tr>
        </tbody>
      </table>
      <p>Providers revoke any time (the Allowance is deleted). Traders approve an exact amount that expires in five minutes, and each order fills at most once.</p>
    </Section>

    <Section id="limits" title="Limitations">
      <ul>
        <li>An Allowance is a permission, not a guarantee: if a provider moves their coins, fills fail.</li>
        <li>One executor today; it can delay orders but not steal.</li>
        <li>Prices are set by providers; there is no oracle yet.</li>
        <li>The shared-liquidity ratio is availability, not TVL: not every market on a budget can fill at once.</li>
        <li>Allowances spend from address balances. Tokens held as Coin objects need one "Move to balance" transaction first (they stay in the wallet).</li>
        <li>Sui Allowances are live on testnet and devnet only. Unaudited hackathon code.</li>
      </ul>
    </Section>

    <Section id="api" title="API">
      <table className="doc-table">
        <thead>
          <tr><th>Endpoint</th><th>Body</th><th>Response</th></tr>
        </thead>
        <tbody>
          <tr><td><code>GET /v1/health</code></td><td></td><td><code>&#123; ok, network, executor, api &#125;</code></td></tr>
          <tr><td><code>GET /v1/strategies</code></td><td></td><td>every market with its state</td></tr>
          <tr><td><code>POST /v1/quote</code></td><td><code>&#123; sell, buy, amountIn | amountOut, slippageBps &#125;</code></td><td>routes, best first, with <code>impactBps</code> and <code>feeBps</code></td></tr>
          <tr><td><code>POST /v1/orders/&#123;id&#125;/fill</code></td><td><code>&#123; takerAllowanceId &#125;</code></td><td><code>&#123; ok, digest &#125;</code> or 409 <code>&#123; ok: false, error &#125;</code></td></tr>
        </tbody>
      </table>
      <p>Amounts are integer strings in base units. Live at <code>https://suijin-api.xfajarr-web3.workers.dev</code>.</p>
    </Section>

    <Section id="sdk" title="SDK">
      <Code>{`
import { createTakerOrder } from '@suijin/sdk';

const [best] = await fetch(API + '/v1/quote', {
  method: 'POST',
  body: JSON.stringify({ sell: 'tUSD', buy: 'tJPY', amountIn: '10000000' }),
}).then((r) => r.json());

const tx = createTakerOrder({
  strategyId: best.strategyId, quoteIn: BigInt(best.quoteIn),
  minBaseOut: BigInt(best.minBaseOut), quotedBaseOut: BigInt(best.baseOut),
  expiresAtMs: Date.now() + 5 * 60_000, recipient: account.address,
  pair: { base: best.baseType, quote: best.quoteType },
});
// sign, then POST /v1/orders/{orderId}/fill with the created payment Allowance id
      `}</Code>
      <p>Also: <code>issueAllowances</code>, <code>createStrategies</code>, <code>setStrategyActive</code>, <code>revokeAllowance</code>, <code>listStrategies</code>, <code>listFills</code>, <code>freshStrategies</code>, <code>freshAllowances</code>.</p>
    </Section>

    <Section id="deployments" title="Deployments">
      <table className="doc-table">
        <tbody>
          <tr><td>Package suijin</td><td><a href={explorer.object(DEPLOYMENT.packageId)} target="_blank" rel="noreferrer"><code>{DEPLOYMENT.packageId}</code></a></td></tr>
          <tr><td>ProtocolConfig</td><td><code>{DEPLOYMENT.configId}</code></td></tr>
          <tr><td>Executor</td><td><code>{DEPLOYMENT.executor}</code></td></tr>
          <tr><td>Package mock_coins</td><td><a href={explorer.object(DEPLOYMENT.mockCoinsPackageId)} target="_blank" rel="noreferrer"><code>{DEPLOYMENT.mockCoinsPackageId}</code></a></td></tr>
          <tr><td>Source</td><td><a href="https://github.com/xfajarr/SUIJIN" target="_blank" rel="noreferrer">github.com/xfajarr/SUIJIN</a></td></tr>
        </tbody>
      </table>
    </Section>
  </article>
);

type Mode = 'guide' | 'tech';
const modeOf = (): Mode => (location.hash.includes('?tech') ? 'tech' : 'guide');

export function Docs() {
  // ?tech keeps the mode shareable: #/docs (guide) or #/docs?tech.
  const [mode, setMode] = useState(modeOf);
  const pick = (m: Mode) => {
    setMode(m);
    history.replaceState(null, '', m === 'tech' ? '#/docs?tech' : '#/docs');
    window.scrollTo(0, 0);
  };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sections = mode === 'tech' ? SECTIONS : GUIDE_SECTIONS;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Docs</h1>
          <p>
            {mode === 'tech'
              ? 'How Suijin works under the hood: the Sui primitives it builds on, the contracts, the math and the API.'
              : 'What Suijin is, how to use it, and what keeps your funds safe. No code needed.'}
          </p>
        </div>
        <Segmented label="Docs for" value={mode} onChange={pick} options={[{ value: 'guide', label: 'Guide' }, { value: 'tech', label: 'Technical' }]} />
      </div>
      <div className="docs">
        <nav className="doc-toc" aria-label="On this page">
          {sections.map(([id, label]) => (
            <button key={id} type="button" onClick={() => go(id)}>
              {label}
            </button>
          ))}
        </nav>
        {mode === 'tech' ? <Technical /> : <Guide />}
      </div>
    </div>
  );
}
