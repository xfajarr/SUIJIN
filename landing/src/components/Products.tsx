import { useEffect, useRef, useState } from 'react'

// Scroll-driven stack: the section is tall, its frame sticks, and each card slides up over the
// previous one until only a header strip of it shows.

// Screenshots of the live testnet app (public/app), one per product.
type Card = { id: string; tab: string; title: string; body: string; shot: string }

const CARDS: Card[] = [
  {
    id: 'earn',
    shot: '/app/earn.png',
    tab: 'Earn',
    title: 'Earn without depositing',
    body: 'Grant a capped, expiring budget and open fixed or curve markets on it. Your coins stay in your wallet and every fill pays you straight back.',
  },
  {
    id: 'swap',
    shot: '/app/swap.png',
    tab: 'Swap',
    title: 'Best price across every market',
    body: 'Quotes read every budget fresh from a fullnode, so the price you see is the price Move recomputes at settlement.',
  },
  {
    id: 'pay',
    shot: '/app/pay.png',
    tab: 'Pay',
    title: 'Pay in the coin they want',
    body: 'Send an exact amount to a merchant in their currency from the one you hold. They get at least what they asked for, or the payment reverts.',
  },
  {
    id: 'limit',
    shot: '/app/limit.png',
    tab: 'Limit',
    title: 'Limit orders that never leave',
    body: 'Sell at your price and wait. Coins stay in your address until a trader fills you, in part or in full. Pause or revoke any time.',
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
        // Each card is as tall as the space left under the strips above it, so its bottom sits
        // on the stack's bottom edge at rest; the clip hides whatever the next card covers.
        const own = height - i * strip
        const next = ys[i + 1]
        const visible = next === undefined ? own : Math.max(strip, Math.min(own, next - ys[i] + 2))
        card.style.height = `${own}px`
        card.style.setProperty('--card-y', `${ys[i]}px`)
        card.style.setProperty('--card-clip', `${Math.max(0, own - visible)}px`)
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
                <img src={c.shot} alt={`Suijin ${c.tab} screen on Sui testnet`} loading="lazy" decoding="async" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
