# Suijin demo video (≈3:30)

Before recording: wallet on testnet with SUI for gas, tUSD + tJPY from the Faucet button, a second address copied for Pay. Open the deck (`docs/pitch.html`) and the app (suijin-app.pages.dev) in two tabs.

| Time | Screen | Say |
|---|---|---|
| **0:00–0:15** | Deck slide 1 | "This is Suijin. One balance, many markets: shared liquidity on Sui where your coins never leave your wallet until a trade settles." |
| **0:15–0:35** | Slide 2 | "Today every venue wants a deposit. Swap pools, limit orders, payment apps: you split one balance four ways, and each market can only use its quarter." |
| **0:35–1:00** | Slide 3 | "Suijin uses a Sui Allowance instead. You grant a permission with a cap and an expiry, spendable only through our contract, revocable any time. Every market can quote against your full balance. Nothing moves." |
| **1:00–1:40** | App → **Earn** | Pick the pair, click *Use market*, keep fee 0.30%, enter amounts, **Grant & open markets**, sign twice. "I become a liquidity provider in two signatures. Look at my balance: nothing left my wallet." |
| **1:40–2:10** | **Trade → Swap** | Type 10 tUSD, show the route, **Swap**, show the receipt. "A trader swaps 10 tUSD. The router picks the best market, and it settles in one transaction: both sides at once, or nothing." |
| **2:10–2:35** | **Trade → Pay** | Paste an address, 1,500 tJPY, **Pay**. "Pay is for merchants: they receive exactly 1,500 tJPY, I pay in tUSD. The minimum is enforced on-chain." |
| **2:35–2:50** | Token picker | Open the picker, scroll SUI / USDC / DEEP, paste a coin type. "It works with any Sui coin, and handles decimals per token." |
| **2:50–3:10** | **Portfolio** | Show the fill on the budget, then **Revoke**. "Fills show up against my budget. One click revokes it, and there's nothing to withdraw." |
| **3:10–3:25** | Deck slide 7 | "The executor only decides when a trade happens. Move decides what: price, amounts and recipients are checked on-chain, or the whole thing reverts." |
| **3:25–3:35** | Slide 11 | "Suijin, one balance, many markets, built natively on Sui. Live on testnet today. Thanks!" |

Tips: record at 1080p, zoom the browser to 110–125%, cut the wallet-signing waits in editing, keep each sentence to one breath.
