# Suijin video script (≈4:00, Sui track)

Three parts: what it is (0:45), how it works live (1:30), how it uses Sui (1:30). The Sui part is the longest because it is what the Sui judges score.

**Before recording**
- Wallet on testnet with SUI for gas, tUSD + tJPY from the Faucet button, a second address copied for Pay.
- Tabs: deck (`docs/pitch.html`), app (suijin-app.pages.dev), Suiscan on a fill tx (e.g. `CFA8Hoqsg4iSztB7g3mzRtk96qAz8YkQ5ffvjPmELJR3`), GitHub `contracts/suijin/sources/app.move` and `settlement.move`.

## 1. What it is (0:00–0:45)

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | Deck slide 1 | "This is Suijin: shared liquidity built on Sui. One wallet balance backs many markets at once, and your coins never leave your wallet until a trade settles." |
| 0:15–0:30 | Slide 2 | "Today every venue wants its own deposit. Swap pools, limit orders, payment apps: one balance gets split four ways and each market only sees a quarter." |
| 0:30–0:45 | Slide 3 | "Suijin replaces the deposit with a Sui Allowance: a permission with a cap and an expiry that only our contract can use. Every market quotes against your full balance, and nothing moves." |

## 2. How it works, live (0:45–2:15)

| Time | Screen | Say |
|---|---|---|
| 0:45–1:15 | App → **Earn** | Pick the pair, *Use market*, enter amounts, *Grant & open*, sign twice. "As a provider I grant a budget, then open fixed-price markets on it. My balance didn't change: nothing was deposited." |
| 1:15–1:40 | **Trade → Swap** | 10 tUSD, *Swap*, receipt. "A trader swaps 10 tUSD. The router picks the best market and the executor settles both sides in one transaction." |
| 1:40–2:00 | **Trade → Pay** | Paste an address, 1,500 tJPY, *Pay*. "Pay: the merchant receives exactly 1,500 tJPY while I pay in tUSD. If the price moves too far, it just doesn't go through." |
| 2:00–2:15 | **Portfolio** + token picker | Show the fill, *Revoke*; open the picker, paste a coin type. "Fills land against my budget, one click revokes it. And it works with any Sui coin: SUI, USDC, or any type you paste." |

## 3. How it uses Sui (2:15–3:45)

| Time | Screen | Say |
|---|---|---|
| 2:15–2:45 | Slide 6, then `app.move` on GitHub | "The core is **app-bound Allowances**, new in the Sui framework. We call `propose_for_app` with our `App` type, so the allowance can only be spent with a permit that our own module mints. Our executor holds the spender role, but it has no way to spend outside Suijin's rules." |
| 2:45–3:05 | Suiscan: the fill tx, *Transaction Blocks / commands* view | "Settlement is one **programmable transaction block**: two allowance withdrawals, the provider's and the trader's, go into `settlement::fill`, and both sides get paid in the same transaction. Coins sit as **address balances**, not objects in a vault, and are delivered with `balance::send_funds`." |
| 3:05–3:25 | `settlement.move` (the `fill` function) | "Inside `fill`, Move recomputes the price, checks the trader's minimum, and checks that both withdrawals match exactly. Markets and orders are **shared objects**, so any fill can be settled. If any check fails, the PTB reverts and nothing moves. The executor decides *when*, Move decides *what*." |
| 3:25–3:45 | Slide 9 | "We also use the **Coin Registry** for token metadata, and read over **gRPC** so quotes match what Move recomputes. It's tested end to end on testnet: 26 Move tests, live fills across SUI with 9 decimals and tUSD with 6." |

## Close (3:45–4:00)

| Time | Screen | Say |
|---|---|---|
| 3:45–4:00 | Slide 11 | "Suijin: one balance, many markets, only possible with Sui Allowances and PTBs. Live on testnet, code on GitHub. Thanks!" |

**Tips:** 1080p, browser zoom 110–125%, cut wallet-signing waits, highlight the lines of Move you mention (select them before talking).
