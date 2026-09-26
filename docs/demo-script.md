# Suijin demo video (≈4:00, Sui track, two browsers)

Deck: `docs/pitch.html` (press F for fullscreen, → for next). Left browser = **Alice** (LP), right browser = **Ben** (trader).

---

**[Slide 1: One Balance, Many Markets]**
"Hi, I'm Fajar, and this is Suijin: a shared liquidity layer on Sui, where one wallet balance can back many markets, and your coins never leave your wallet until a trade settles."

**[Slide 2: Every market wants its own deposit]**
"Today every venue wants a deposit. Swap pools, limit orders, payment apps: one balance gets split, and each market only sees a piece of it."

**[Slide 3: Grant a permission, not a deposit]**
"Suijin replaces the deposit with a Sui Allowance: a permission with a cap and an expiry that only our contract can use. Every market can quote against the full balance, and nothing moves."

**[Slide 4: Two sides meet in one PTB]**
"A provider grants an allowance and opens a market. A trader places an order. Then both sides settle in one PTB, and that's the only place coins ever move. Let me show it live with two browsers: one LP, one trader."

---

**[LEFT browser: Alice → Portfolio]**
"This is Alice. She holds tJPY in her own wallet."

**[LEFT: Earn → Sell tJPY → Fixed price → Use market → + twice → fee 0.05% → amount]**
"She offers tJPY at a fixed price, slightly better than the market, with a 0.05% fee. The preview shows exactly what she gets if it all sells."

**[LEFT: Grant budget & open market → sign twice → Portfolio]**
"Two signatures: one grants the allowance, one opens the market. Her balance didn't change: nothing was deposited. The budget is just a permission."

**[RIGHT browser: Ben → Swap 10 tUSD → open details → Route]**
"This is Ben. He wants tJPY. Suijin quotes every market, and the best one is from Alice's address."
*(If hers isn't first, click her route.)*

**[RIGHT: Swap → sign once → receipt]**
"Ben signs one approval for exactly 10 tUSD, and the executor settles both sides in one transaction, because we use a PTB."

**[RIGHT: click Settlement ↗ on Suiscan]**
"On-chain: Ben paid 10 tUSD and got tJPY. Alice's tJPY left her wallet and her tUSD arrived, in the same transaction."

**[LEFT: Alice → Portfolio → Markets / Activity]**
"Back to Alice. She sees the fill: tJPY sold, tUSD received, budget used. She never deposited anything."

**[LEFT: Budgets → Revoke]**
"And she can revoke her budget any time. One click and the permission is gone. Nothing to withdraw."

---

**[Slide 6: Built from Sui primitives]**
"The core is Sui's app-bound Allowances. Our executor is the spender, but a spend needs a permit that only our module can mint, so funds can only move through Suijin's rules. Coins stay as address balances, fills are PTBs, and markets are shared objects."

**[Slide 7: The executor picks when, Move decides what]**
"The executor only decides when. Move decides what: it recomputes the price, checks the trader's minimum and the exact amounts. If anything fails, the whole PTB reverts and nothing moves."

**[Slide 9: Built and tested this weekend]**
"It's live on Sui testnet: five Move modules, 26 Move tests, and live fills with any Sui coin, even across different decimals like SUI and tUSD."

**[Slide 11: Try it]**
"That's Suijin: one balance, many markets, only possible with Sui Allowances and PTBs. Try it at suijin-app.pages.dev. Thank you!"

---

Skipped on purpose (keep under 4 min): slide 5 (products), slide 8 (demo slide, replaced by the live demo), slide 10 (next steps). Show them only if you have time.
