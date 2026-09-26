const APP_URL = 'https://suijin-app.xfajarr-web3.workers.dev'

const QA: [string, React.ReactNode][] = [
  [
    'What is Suijin?',
    'A shared-liquidity layer on Sui. One wallet balance can back several markets at once (fixed price, curve, limit orders), and coins move only when a trade settles.',
  ],
  [
    'Do I deposit my coins anywhere?',
    'No. You grant a Sui Allowance instead: a capped, expiring permission that only Suijin’s contract can use. Your coins stay in your address until a trade settles.',
  ],
  [
    'If one balance backs many markets, is that leverage?',
    'No. Every market sees the same balance, but no mix of fills can spend more than you actually hold or more than your cap. Shared availability, not borrowed money.',
  ],
  [
    'Who executes trades, and can they take my funds?',
    'An executor submits each settlement. It can choose when, never what: the contract recomputes the price, checks the exact amounts and recipients, and reverts the whole trade if anything does not match.',
  ],
  [
    'What happens if I move my coins elsewhere?',
    'Trades against your markets simply fail until the balance is back. Nothing is lost, and traders never pay for a fill that did not happen.',
  ],
  [
    'How do I stop providing liquidity?',
    'Pause a single market, or revoke the Allowance from Portfolio. There is nothing to withdraw because nothing was deposited.',
  ],
  [
    'Is it live?',
    'On Sui testnet, with test tUSD and tJPY. Sui Allowances are not on mainnet yet, and this is unaudited hackathon code.',
  ],
  [
    'How do I try it?',
    <>
      Open the <a href={APP_URL}>testnet app</a>, connect a Sui wallet on testnet, and use the Faucet button for test coins. Then swap, pay, set a
      limit order, or earn.
    </>,
  ],
]

export default function Faq() {
  return (
    <section className="faq" id="faq" aria-labelledby="faq-title">
      <div className="faq-head">
        <span className="kicker">
          <i />
          FAQ
        </span>
        <h2 id="faq-title">Questions, answered</h2>
        <p>Short answers about custody, safety and how to try Suijin today.</p>
      </div>
      <div className="faq-list">
        {QA.map(([q, a], i) => (
          // name= makes the group exclusive: opening one closes the others, no JS
          <details key={q} name="faq" open={i === 0}>
            <summary>
              <span className="faq-num">0{i + 1}</span>
              {q}
              <span className="faq-icon" aria-hidden="true" />
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
