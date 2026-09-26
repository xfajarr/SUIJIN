import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { initLanding } from '#/lib/landing'
import Footer from '#/components/Footer'
import Products from '#/components/Products'
import Faq from '#/components/Faq'

export const Route = createFileRoute('/')({ component: Landing })

const APP_URL = 'https://suijin-app.xfajarr-web3.workers.dev'

const CHIPS = [
  ['Strategy', 'AMM'],
  ['Strategy', 'Limit orders'],
  ['Strategy', 'RFQ'],
  ['Strategy', 'Launchpad'],
  ['Sui primitive', 'Allowance'],
  ['Sui primitive', 'Address balance'],
  ['Sui primitive', 'PTB'],
  ['Offchain', 'Resolver'],
  ['Onchain', 'Executor'],
  ['Network', 'Sui Testnet'],
]

const STEPS = [
  ['Sui Allowance', 'Grant an Allowance', 'Give Suijin a bounded, revocable, app-bound spend limit. Nothing is deposited into a pool.'],
  ['Strategies', 'Assign virtual limits', 'Point the same inventory at AMM, limit, RFQ and launchpad strategies, each with its own cap.'],
  ['Resolver', 'Resolver finds the quote', 'Incoming orders are matched against every strategy your balance backs, and the best executable price wins.'],
  ['PTB', 'Settle in one PTB', 'The executor pulls funds through the Allowance and settles atomically. Every fill is capped at'],
]

const SUI_PATH =
  'M17.636 10.009a7.16 7.16 0 0 1 1.565 4.474 7.2 7.2 0 0 1-1.608 4.53l-.087.106-.023-.135a7 7 0 0 0-.07-.349c-.502-2.21-2.142-4.106-4.84-5.642-1.823-1.034-2.866-2.278-3.14-3.693-.177-.915-.046-1.834.209-2.62.254-.787.631-1.446.953-1.843l1.05-1.284a.46.46 0 0 1 .713 0l5.28 6.456zm1.66-1.283L12.26.123a.336.336 0 0 0-.52 0L4.704 8.726l-.023.029a9.33 9.33 0 0 0-2.07 5.872C2.612 19.803 6.816 24 12 24s9.388-4.197 9.388-9.373a9.32 9.32 0 0 0-2.07-5.871zM6.389 9.981l.63-.77.018.142q.023.17.055.34c.408 2.136 1.862 3.917 4.294 5.297 2.114 1.203 3.345 2.586 3.7 4.103a5.3 5.3 0 0 1 .109 1.801l-.004.034-.03.014A7.2 7.2 0 0 1 12 21.67c-3.976 0-7.2-3.218-7.2-7.188 0-1.705.594-3.27 1.587-4.503z'

const SuiIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={SUI_PATH} />
  </svg>
)

const w = (pct: string) => ({ '--w': pct }) as React.CSSProperties

// Per-step illustration, using the numbers from the testnet demo flow.
function StepViz({ i }: { i: number }) {
  if (i === 0)
    return (
      <div className="viz" aria-hidden="true">
        <div className="viz-head"><span>Allowance</span><em>app-bound</em></div>
        <dl className="viz-rows">
          <div><dt>Cap</dt><dd>1,000,000 tJPY</dd></div>
          <div><dt>Spent</dt><dd>150,000 tJPY</dd></div>
        </dl>
        <div className="viz-bar"><i style={w('15%')} /></div>
        <dl className="viz-rows">
          <div><dt>Spender</dt><dd>executor</dd></div>
          <div><dt>Expires</dt><dd>in 12 h</dd></div>
        </dl>
        <span className="viz-chip">Revocable anytime</span>
      </div>
    )
  if (i === 1)
    return (
      <div className="viz" aria-hidden="true">
        <div className="viz-head"><span>One balance</span><em>1,000,000 tJPY</em></div>
        {[['Fixed', '150 per tUSD'], ['Curve', '30 bps'], ['Fixed #2', '148 per tUSD']].map(([k, v]) => (
          <div className="viz-strat" key={k}>
            <span>{k} <b>· {v}</b></span>
            <span>1M</span>
            <div className="viz-bar"><i style={w('100%')} /></div>
          </div>
        ))}
        <div className="viz-total"><span>Shared ratio · not leverage</span><strong>3.0×</strong></div>
      </div>
    )
  if (i === 2)
    return (
      <div className="viz" aria-hidden="true">
        <div className="viz-head"><span>Quotes</span><em>pay 10 tUSD</em></div>
        <div className="viz-quote best"><span>Fixed<i className="viz-tag">Best</i></span><b>1,500.00 tJPY</b></div>
        <div className="viz-quote"><span>Curve · 30 bps</span><b>1,493.27 tJPY</b></div>
        <div className="viz-quote"><span>Fixed #2</span><b>1,480.00 tJPY</b></div>
        <p className="viz-note">Expires in 60 s · 1% max slippage</p>
      </div>
    )
  return (
    <div className="viz" aria-hidden="true">
      <div className="viz-head"><span>One PTB</span><em>2 allowances</em></div>
      <div className="viz-flow"><span>Taker</span><span className="arrow"><em>10 tUSD</em></span><span>Maker</span></div>
      <div className="viz-flow gold"><span>Maker</span><span className="arrow"><em>1,500 tJPY</em></span><span>Taker</span></div>
      <p className="viz-note ok">Settles atomically, or nothing moves</p>
    </div>
  )
}

// Renders each character as its own span so CSS can stagger the reveal.
function SplitTitle({ as: Tag, text, id }: { as: 'h1' | 'h2'; text: string; id?: string }) {
  let i = 0
  const words = text.split(' ')
  return (
    <Tag aria-label={text} id={id}>
      {words.map((w, k) => (
        <span key={k}>
          <span className="title-word">
            {[...w].map((ch) => (
              <span key={i} className="title-char" aria-hidden="true" style={{ '--i': i++ } as React.CSSProperties}>
                {ch}
              </span>
            ))}
          </span>
          {k < words.length - 1 && ' '}
        </span>
      ))}
    </Tag>
  )
}

function Landing() {
  useEffect(() => initLanding(), [])

  return (
    <>
      <div className="preloader" role="status" aria-live="polite">
        <img className="preloader-logo" src="/logo.png" alt="Suijin" />
        <div className="preloader-status">
          <span>Filling the pool</span>
          <strong>
            <b>0</b>%
          </strong>
        </div>
      </div>
      <div className="custom-cursor" aria-hidden="true">
        <span className="cx-h" />
        <span className="cx-v" />
        <span className="cx-box" />
        <span className="cx-dot" />
        <span className="cx-tip">
          <span className="q">
            BID <b className="bid">0</b> · ASK <b className="ask">0</b>
          </span>
          <span className="q">
            DEPTH <b>1,000 SUI</b> × 3 strategies
          </span>
          <span className="go">EXECUTE IN ONE PTB ›</span>
          <span>CLICK TO PLACE A LIMIT</span>
        </span>
        <span className="cx-price" />
        <span className="cx-time" />
      </div>
      <canvas id="scene" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <header className="site-header">
        <a className="brand" href="#top">
          <img src="/logo.png" alt="" />
          Suijin
        </a>
        <nav aria-label="Primary">
          <a href="#markets">Markets</a>
          <a href="#how">How it works</a>
          <a href="#how">Safety</a>
          <a href={`${APP_URL}/#/docs`}>Docs</a>
        </nav>
        <a className="pill primary demo" href={APP_URL}>
          Launch testnet app
        </a>
      </header>

      <section className="hero-ui" aria-label="Suijin">
        <div className="hero-title">
          <div className="hero-tags">
            <span className="kicker">
              <SuiIcon />
              Shared liquidity on Sui
            </span>
            <a className="sui-badge" href="https://sui.io" target="_blank" rel="noreferrer">
              Built on
              <SuiIcon />
              Sui
            </a>
          </div>
          <SplitTitle as="h1" text="One Balance, Many Markets" />
          <div className="hero-copy">
            <p>
              Suijin lets one Sui wallet balance back an AMM, limit orders, RFQ and launch markets at the same time.{' '}
              <strong>Your SUI stays in your address until a trade settles</strong>, atomically, in a single PTB.
            </p>
            <div className="actions">
              <a className="pill primary" href="#how">
                See how it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <div className="chip-flight" aria-label="Strategies one balance can serve">
        {CHIPS.map(([kind, name]) => (
          <div className="chip" key={name}>
            <small>{kind}</small>
            <b>{name}</b>
          </div>
        ))}
      </div>

      <section className="second-ui" aria-label="How Suijin works">
        <SplitTitle as="h2" text="Liquidity Stays In Your Wallet" />
        <p className="second-intro">
          Each strategy sees the full balance, and funds move only when a valid trade executes.{' '}
          <strong>Shared availability is not leverage:</strong> no mix of fills can ever spend more SUI than you hold.
        </p>
      </section>

      <main id="top" aria-hidden="true">
        <div id="markets" />
      </main>

      <section className="steps" id="how" aria-labelledby="steps-title">
        <div className="steps-head">
          <span className="kicker">
            <i />
            How a trade settles
          </span>
          <SplitTitle as="h2" id="steps-title" text="Four steps, one PTB" />
          <p>From permission to settlement. Your SUI stays in your address the whole time, until the moment a fill executes.</p>
        </div>
        <ol className="steps-list">
          {STEPS.map(([tag, title, body], i) => (
            <li className="step-card" key={title} style={{ '--i': i } as React.CSSProperties}>
              <div className="step-inner">
                <span className="step-num" aria-hidden="true" data-parallax>0{i + 1}</span>
                <div className="step-text">
                  <small>Step 0{i + 1} of 04 · {tag}</small>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  {i === 3 && <code>min(balance, allowance, strategy limit, order)</code>}
                </div>
                <StepViz i={i} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Products />

      <Faq />

      <Footer />
    </>
  )
}
