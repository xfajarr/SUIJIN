import { useEffect, useRef, useState } from 'react'

// Scroll-driven stack: the section is tall, its frame sticks, and each card slides up over the
// previous one until only a header strip of it shows.

type Row = [string, string, ('teal' | 'gold')?]
type Card = { id: string; tab: string; title: string; body: string; head: string; code?: string[]; rows?: Row[] }

const CARDS: Card[] = [
  {
    id: 'earn',
    tab: 'Earn',
    title: 'Earn without depositing',
    body: 'Grant a capped, expiring budget and open fixed or curve markets on it. Your coins stay in your wallet and every fill pays you straight back.',
    head: 'strategy.move',
    code: [
      'strategy::create_curve<TJPY, TUSD>(',
      '  maker_allowance,   // 1,000,000 tJPY cap',
      '  virtual_base,      // budget × 20',
      '  virtual_quote,     // starts at 150.41',
      '  30,                // fee_bps',
      '  max_base_per_fill,',
      '  expiry_ms,         // 24 h',
      ')',
    ],
  },
  {
    id: 'swap',
    tab: 'Swap',
    title: 'Best price across every market',
    body: 'Quotes read every budget fresh from a fullnode, so the price you see is the price Move recomputes at settlement.',
    head: 'Quote · pay 10 tUSD',
    rows: [
      ['Fixed · 0.05%', '1,503.35 tJPY', 'gold'],
      ['Curve · 0.30%', '1,499.02 tJPY'],
      ['Fixed · 1.00%', '1,489.10 tJPY'],
      ['Min received', '1,488.32 tJPY', 'teal'],
    ],
  },
  {
    id: 'pay',
    tab: 'Pay',
    title: 'Pay in the coin they want',
    body: 'Send an exact amount to a merchant in their currency from the one you hold. They get at least what they asked for, or the payment reverts.',
    head: 'Payment request',
    rows: [
      ['Merchant gets', '1,500 tJPY', 'gold'],
      ['You pay', '≤ 10.08 tUSD'],
      ['Approval', 'exact · 5 min'],
      ['Settles', 'one PTB', 'teal'],
    ],
  },
  {
    id: 'limit',
    tab: 'Limit',
    title: 'Limit orders that never leave',
    body: 'Sell at your price and wait. Coins stay in your address until a trader fills you, in part or in full. Pause or revoke any time.',
    head: 'Limit order',
    rows: [
      ['Sell', '500 tUSD'],
      ['At', '152.00 tJPY', 'gold'],
      ['Filled', '120 / 500'],
      ['Custody', 'your wallet', 'teal'],
    ],
  },
]

export default function Products() {
  const section = useRef<HTMLElement>(null)
  const stack = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const cards = Array.from(stack.current?.children ?? []) as HTMLElement[]
    const update = () => {
      const s = section.current
      if (!s || !cards.length) return
      const rect = s.getBoundingClientRect()
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - innerHeight)))
      const max = cards.length - 1
      const raw = progress * max
      const height = stack.current?.clientHeight ?? innerHeight * 0.74
      const strip = 64 // header strip: the '02 · Swap' label only
      const ys = cards.map((_, i) => {
        if (i === 0) return 0
        const t = Math.min(1, Math.max(0, raw - (i - 1)))
        return Math.round(height + strip + (i * strip - height - strip) * t)
      })
      cards.forEach((card, i) => {
        const next = ys[i + 1]
        const visible = next === undefined ? height : Math.max(strip, Math.min(height, next + 2))
        card.style.setProperty('--card-y', `${ys[i]}px`)
        card.style.setProperty('--card-clip', `${Math.max(0, height - visible)}px`)
        card.style.zIndex = String(i + 1)
      })
      setActive(Math.round(raw))
    }
    addEventListener('scroll', update, { passive: true })
    addEventListener('resize', update)
    update()
    return () => {
      removeEventListener('scroll', update)
      removeEventListener('resize', update)
    }
  }, [])

  const go = (i: number) => {
    const s = section.current
    if (!s) return
    scrollTo({ top: s.offsetTop + (i / (CARDS.length - 1)) * (s.offsetHeight - innerHeight), behavior: 'smooth' })
  }

  return (
    <section className="products" id="products" ref={section} aria-labelledby="products-title">
      <h2 id="products-title" className="sr-only">
        What you can do with one balance
      </h2>
      <div className="products-inner">
        <div className="products-nav" role="tablist" aria-label="Products">
          {CARDS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-controls={`product-${c.id}`}
              className={i === active ? 'active' : undefined}
              onClick={() => go(i)}
            >
              {c.tab}
            </button>
          ))}
        </div>
        <div className="products-stack" ref={stack} aria-live="polite">
          {CARDS.map((c, i) => (
            <article key={c.id} id={`product-${c.id}`} className="product-card" aria-hidden={i !== active} role="tabpanel">
              <div className="product-copy">
                <small>0{i + 1} · {c.tab}</small>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
              <div className="product-visual">
                <div className={`code-window${c.rows ? ' metric' : ''}`}>
                  <div className="code-bar">
                    <span />
                    <span />
                    <span />
                    <em>{c.head}</em>
                  </div>
                  {c.code ? (
                    <pre>
                      <code>
                        {c.code.map((line, n) => (
                          <span key={n}>
                            <i>{String(n + 1).padStart(2, '0')}</i>
                            {line}
                            {'\n'}
                          </span>
                        ))}
                      </code>
                    </pre>
                  ) : (
                    <dl>
                      {c.rows!.map(([k, v, tone]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd className={tone}>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
