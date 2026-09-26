# Suijin demo video (≈4:00, Sui track, two browsers)

Two people, two browsers side by side:
- **Browser A = Aiko, the provider.** Earns by quoting from her wallet.
- **Browser B = Ben, the trader.** Swaps against Aiko's market.

## Setup (before recording)

1. Two browsers (e.g. Chrome and Brave), each with its **own** Sui wallet on **testnet**. Put them side by side.
2. Both wallets need SUI for gas: faucet.sui.io.
3. Open suijin-app.pages.dev in both, connect, press **Faucet** in both (tUSD + tJPY).
4. Note Aiko's address ending (e.g. `…a1b2`): you will point at it on Ben's screen.
5. Other tabs: the deck (`docs/pitch.html`), GitHub `contracts/suijin/sources/app.move` and `settlement.move`, Suiscan.
6. Browser zoom 110–125%, 1080p recording. Cut the wallet-signing waits when editing.

## Script

### 1. What it is (0:00–0:40), deck

| Time | Screen | Say |
|---|---|---|
| 0:00–0:12 | Slide 1 | "This is Suijin: shared liquidity on Sui. One wallet balance backs many markets, and your coins never leave your wallet until a trade settles." |
| 0:12–0:25 | Slide 2 | "Today every venue wants a deposit, so one balance gets split and each market only sees a piece of it." |
| 0:25–0:40 | Slide 3 | "Suijin replaces the deposit with a Sui Allowance: a permission with a cap and an expiry that only our contract can use. Let me show it with two people." |

### 2. Aiko earns, Browser A (0:40–1:35)

| Time | Do | Say |
|---|---|---|
| 0:40–0:50 | **Portfolio**: show Balances | "This is Aiko. She holds 150,000 tJPY in her own wallet." |
| 0:50–1:15 | **Earn**: pair tUSD / tJPY → **Sell tJPY** → **Fixed price** → *Use market* → press **+** twice → fee **0.05%** → sell up to **10,000 tJPY** → 24 h | "She offers tJPY at a fixed price, slightly better than the market, with a 0.05% fee. The preview shows exactly what she gets if it all sells." |
| 1:15–1:35 | **Grant budget & open market**, sign twice → **Portfolio** | "Two signatures: one grants the allowance, one opens the market. Her balance is still 150,000: nothing was deposited. The budget is just a permission." |

### 3. Ben swaps with Aiko, Browser B (1:35–2:25)

| Time | Do | Say |
|---|---|---|
| 1:35–1:55 | **Swap**: sell **10 tUSD** → buy tJPY → open **"You get at least…"** → show **Route** | "This is Ben. He wants tJPY. Suijin quotes every market; the best one is from Aiko's address, `…a1b2`." (If hers isn't first, click her route.) |
| 1:55–2:10 | **Swap**, sign once → receipt | "Ben signs one approval for exactly 10 tUSD. The executor settles both sides in one transaction." |
| 2:10–2:25 | Click **Settlement ↗** | "On-chain: Ben paid 10 tUSD, got tJPY. Aiko's tJPY left her wallet and her tUSD arrived, in the same transaction." |

### 4. Back to Aiko, Browser A (2:25–2:50)

| Time | Do | Say |
|---|---|---|
| 2:25–2:40 | **Portfolio** → Markets / Activity | "Aiko sees the fill: tJPY sold, tUSD received, budget used. She never deposited anything." |
| 2:40–2:50 | **Budgets → Revoke** | "One click and the permission is gone. Nothing to withdraw." |

### 5. How it uses Sui (2:50–3:50)

| Time | Screen | Say |
|---|---|---|
| 2:50–3:10 | `app.move` lines 68–78 | "The core is Sui's **app-bound Allowances**. Our executor is the spender, but a spend needs a permit only our module can mint, so it can only move funds through Suijin's rules." |
| 3:10–3:30 | Suiscan: Ben's fill tx | "Settlement is one **PTB**: Aiko's and Ben's allowance withdrawals go into `settlement::fill`, and both sides are paid from **address balances** with `send_funds`. No vault, no pool." |
| 3:30–3:50 | `settlement.move` from line 32 | "Move recomputes the price, checks Ben's minimum and the exact amounts. Any mismatch and the whole PTB reverts. The executor decides when, Move decides what." |

### 6. Close (3:50–4:00)

| Time | Screen | Say |
|---|---|---|
| 3:50–4:00 | Slide 11 | "Suijin: one balance, many markets, only possible with Sui Allowances and PTBs. Live on testnet. Thanks!" |

## If something goes wrong
- **Ben's best route isn't Aiko:** open the route list and click her market, or have Aiko press + one more time.
- **"Need testnet SUI for gas":** faucet.sui.io for that wallet.
- **Swap fails:** get a fresh quote and swap again; nothing moved.
