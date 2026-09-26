# Suijin End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Suijin ("One Balance, Many Markets") on Sui testnet before the ETHGlobal Tokyo deadline (Sun 2026-09-27 09:00 JST). The build must show three things. One maker address balance backs two pricing strategies through one app-bound Allowance. A trade settles in one PTB that pulls from the maker's and the taker's Allowances. A revoke blocks every later fill.

**Architecture:** There are two Move packages. `suijin` holds `app`, `math`, `strategy`, `order` and `settlement`. `mock_coins` holds the demo coins tUSD and tJPY, each with an open faucet. A shared TypeScript SDK (`packages/sdk`) builds transactions, mirrors the Move math and reads chain state. One Bun server (`apps/server`) is both the quote resolver and the executor: it holds the only spender key and submits fills. A Vite + React dApp (`apps/web`) on dapp-kit v2 gives the maker and taker UI. Object reads use GraphQL, which has a stable JSON shape. Balances and execution use gRPC. Public JSON-RPC is switched off.

**Tech Stack:** Sui CLI 1.80.1 (Move 2024, `sui::allowance`, address balances), `@mysten/sui` 2.33.1, `@mysten/dapp-kit-react` 2.1.35, Bun 1.3, TypeScript 5.9, React 19, Vite 7.

---

## 0. Read first

- **Spec:** `../sui-shared-liquidity-prd-spec.md` is the product source of truth. Section 2 lists where this plan intentionally departs from it. Add those to the spec's Decision Log.
- **Deadline:** submit by **08:00 JST Sunday**, one hour before the 09:00 cut-off.
- **Everything here was verified on 2026-09-26** in a scratch copy of this exact tree (sui 1.80.1, bun 1.3.11):
  - `sui move test`: **26/26 pass**
  - `bun run test:ts`: **22/22 pass**
  - `bun run typecheck`: clean
  - `vite build`: OK
  - **Live end-to-end on devnet with these contracts** (`FRESH=1 bun scripts/e2e.ts` → `E2E OK`):
    - publish suijin `FooxtgyWqbuuJSVRruZ5rwdYgedk7AWMn1kbCWXt7w5C`
    - fill in one PTB with two app-bound Allowances `6Zuuyt9vXiZEFP7aKNZhdiBgoHaEZmrdretAGWLHhjPa`
    - overdraw attempt aborted with `EWrongMakerAmount`
    - revoke `DnZ7Jo4XurzdFcp5Rm8PUA86QxEM6RD6G7nFAkrmsJ4U`, after which the next fill was refused
  - These digests prove spec OQ-001 and OQ-002. The fallback escrow design (spec §7.5) is **not needed**.
- **Network facts** (checked live on 2026-09-26):
  - `enable_allowances` is true on testnet (protocol 137) and devnet (138), and false on mainnet.
  - Public-fullnode JSON-RPC answers "Method not found".
  - The testnet faucet API can return 429. Use the web faucet or a teammate's wallet.

## 1. Architecture at a glance

```
Maker wallet (address balance: tJPY)          Taker wallet (address balance: tUSD)
  │ 1. propose_for_app + app::issue_maker_allowance  │ 3. propose_for_app + order::create (one tx)
  ▼                                                  ▼
┌──────────────────────── Move package `suijin` ────────────────────────┐
│ Allowance<Balance<TJPY>> (app-bound to suijin::app::App)              │
│ Strategy A (fixed)   Strategy B (curve)   ← both point at it          │
│ SwapOrder + Allowance<Balance<TUSD>> (exact cap = quote_in)           │
│ 4. settlement::fill: checks everything, app_balance_spend ×2,         │
│    send_funds tUSD → maker, tJPY → recipient, emit Fill               │
└──────────────────────────────────────────────────────────────────────┘
  ▲ 2. GraphQL reads (strategies, allowances)   ▲ 4. fill PTB (sender = executor)
apps/server: POST /v1/quote (resolver)  ·  POST /v1/orders/:id/fill (executor)
  ▲
apps/web (dapp-kit v2): Maker tab · Trade tab · settlement inspector
```

## 2. Decisions that update the spec

| # | Decision | Why |
|---|---|---|
| D1 | The witness is `suijin::app::App`, not `APP` | `APP` inside module `app` is a one-time witness, and the compiler rejects it outside `init` |
| D2 | Demo pair: **tJPY (base, sold by makers) / tUSD (quote, paid by takers)**. Both are mock coins with 6 decimals and open faucets | The testnet faucet cannot supply 1,000 SUI of inventory. Gas paid from a SUI address balance would break AC-001's "balance unchanged". The pair also reads as a payments / FX story for the Sui track. The protocol stays generic `<Base, Quote>` |
| D3 | `SwapOrder` has **no** `taker_allowance_id`. Fill binds the payment allowance by funder = taker, cap = `quote_in` and expiry = order expiry | `allowance::issue` returns nothing, so the new ID cannot be referenced in the same PTB |
| D4 | The curve's new base reserve rounds **up**. All math runs in u128 | Rounding dust stays with the maker, and nothing can overflow (a Cetus-style bug) |
| D5 | Resolver and executor are one Bun server. The web app calls `POST /v1/orders/:id/fill` right after the order transaction. There is no event polling in P0 | Fewer moving parts and lower latency. The order's on-chain status is the real replay guard |
| D6 | Vite + React + `@mysten/dapp-kit-react` v2 instead of Next.js | The spec only suggested Next.js. Vite has no SSR or wallet hydration issues. dapp-kit v2 is gRPC-native |
| D7 | Object reads use GraphQL. Balances and transactions use gRPC. No JSON-RPC | JSON-RPC is off on public fullnodes. The GraphQL JSON shape is stable (verified) |
| D8 | Publish through the SDK (`scripts/deploy.ts`) with the **executor key**. Executor = publisher | `ProtocolConfig.executor` is set in `init`. The script records every ID into `packages/sdk/src/deployment.json` |
| D9 | Events are declared in the module that emits them (no `events.move`) | Sui only lets a module emit event types it defines |
| D10 | A maker allowance must have an expiry (`ENoExpiry`) | Keeps the maker's permission bounded in time, as spec §6.1 wants |

## 3. File structure

```
suijin/
  package.json               bun workspaces + root scripts
  tsconfig.json              typecheck for sdk, server, scripts
  .gitignore  .env.example
  contracts/
    mock_coins/              tUSD + tJPY, shared Faucet each (testnet-only, no value)
      Move.toml  sources/tusd.move  sources/tjpy.move
    suijin/
      Move.toml
      sources/math.move        pure pricing math (fixed, curve), u128
      sources/app.move         App witness, ProtocolConfig, AdminCap, the ONLY permit minting
      sources/strategy.move    Strategy object: create, pause, quote, record fills
      sources/order.move       SwapOrder: create with payment allowance, cancel
      sources/settlement.move  fill: the atomic swap
      tests/math_tests.move  tests/app_tests.move  tests/strategy_tests.move
      tests/order_tests.move tests/settlement_tests.move
  packages/sdk/              shared by server, web, scripts
    src/config.ts  src/deployment.json  src/math.ts  src/state.ts
    src/quote.ts   src/tx.ts            src/read.ts  src/index.ts
    tests/math.test.ts  tests/quote.test.ts
  apps/server/               resolver + executor (holds EXECUTOR_SECRET_KEY)
    src/plan.ts  src/executor.ts  src/index.ts  tests/plan.test.ts
  apps/web/                  dApp
    index.html  vite.config.ts  tsconfig.json
    src/dapp-kit.ts  src/chain.ts  src/Maker.tsx  src/Trade.tsx  src/App.tsx  src/main.tsx  src/styles.css
  scripts/                   deploy.ts (publish + record IDs), e2e.ts (live proof)
  docs/superpowers/plans/    this file
```

## 4. Team lanes and timeline (JST)

Four lanes run in parallel. Everyone does Task 1 and Task 2 together. The lane code only meets at deploy time (Task 13).

| Time | Lane A: Move | Lane B: SDK + scripts | Lane C: server | Lane D: web |
|---|---|---|---|---|
| 14:30–15:00 | Tasks 1–2 (all) | Tasks 1–2 | Tasks 1–2 | Tasks 1–2 |
| 15:00–18:00 | Tasks 3–8 | Tasks 9–11 | Task 14, then help Lane D | Tasks 16–17 |
| 18:00–19:45 | review + help | Task 12 (devnet), Task 13 (testnet deploy + e2e) | Task 15 (after Task 13) | Task 18 |
| 20:00–21:00 | Task 19 (all, UI on testnet) | | | |
| 21:00–23:00 | Task 20 dress rehearsal + fixes (all) | | | |
| 23:00–01:00 | Task 21 README, Task 22 video (two people) · others sleep | | | |
| 06:00–08:00 | Task 22 rehearse twice, Task 23 submit by **08:00** | | | |

Rule: **freeze scope at 21:00**. After that, only bug fixes.

---

## Phase 0: Setup (all)

### Task 1: Toolchain and repo scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
- Create: `packages/sdk/package.json`, `apps/server/package.json`, `apps/web/package.json`, `scripts/package.json`

- [ ] **Step 1: Upgrade the Sui CLI (every laptop)**

```bash
brew upgrade sui && sui --version
```
Expected: `sui 1.80.1-...` or newer. Anything below 1.80 has no `sui::allowance`.

- [ ] **Step 2: Create the root files**

`package.json`:
```json
{
  "name": "suijin",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*", "scripts"],
  "scripts": {
    "test:move": "cd contracts/suijin && sui move test",
    "test:ts": "bun test packages/sdk apps/server",
    "typecheck": "tsc -p tsconfig.json && tsc -p apps/web/tsconfig.json",
    "deploy": "bun scripts/deploy.ts testnet",
    "e2e": "bun scripts/e2e.ts",
    "server": "bun apps/server/src/index.ts",
    "web": "cd apps/web && bunx vite"
  },
  "devDependencies": {
    "@types/bun": "^1.3.0",
    "typescript": "^5.9.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["packages/*/src", "packages/*/tests", "apps/server/src", "apps/server/tests", "scripts"]
}
```

`.gitignore`:
```
node_modules
dist
contracts/*/build
.env
*.log
.DS_Store
```

`.env.example`:
```bash
# Export with: sui keytool export --key-identity <alias>   (value starts with suiprivkey1...)
EXECUTOR_SECRET_KEY=
MAKER_SECRET_KEY=
TAKER_SECRET_KEY=
PORT=8787
```

- [ ] **Step 3: Create every workspace `package.json` now, so one install covers all lanes**

`packages/sdk/package.json`:
```json
{ "name": "@suijin/sdk", "type": "module", "main": "src/index.ts", "dependencies": { "@mysten/sui": "2.33.1" } }
```

`apps/server/package.json`:
```json
{ "name": "@suijin/server", "type": "module", "dependencies": { "@suijin/sdk": "workspace:*", "@mysten/sui": "2.33.1" } }
```

`scripts/package.json`:
```json
{ "name": "@suijin/scripts", "type": "module", "dependencies": { "@suijin/sdk": "workspace:*", "@mysten/sui": "2.33.1" } }
```

`apps/web/package.json`:
```json
{
  "name": "@suijin/web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -p tsconfig.json && vite build" },
  "dependencies": {
    "@mysten/dapp-kit-react": "2.1.35",
    "@mysten/sui": "2.33.1",
    "@suijin/sdk": "workspace:*",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.1.0"
  }
}
```

- [ ] **Step 4: Install and init git**

```bash
cd /Users/xfajarr/Hackathon/ethglobal-tokyo/suijin
git init && bun install
```
Expected: `Saved lockfile`, about 200 packages installed, no errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold suijin workspace"
```

### Task 2: Keys and testnet funds

**Files:** Create `.env` (git-ignored, never commit)

- [ ] **Step 1: Generate executor, maker and taker keys into `.env`**

```bash
cd /Users/xfajarr/Hackathon/ethglobal-tokyo/suijin/scripts
for who in EXECUTOR MAKER TAKER; do
  bun -e "import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'; const k = new Ed25519Keypair(); console.log('# ${who} ' + k.toSuiAddress()); console.log('${who}_SECRET_KEY=' + k.getSecretKey())" >> ../.env
done
echo "PORT=8787" >> ../.env && cat ../.env
```
Expected: three `# NAME 0x…` comment lines, each followed by `NAME_SECRET_KEY=suiprivkey1…`.

- [ ] **Step 2: Fund on testnet**

- Executor: at least **2 SUI** from https://faucet.sui.io (choose Testnet, paste the executor address). It pays for publishing and for every fill.
- Maker and taker: 0.5 SUI each for gas. Send it from any funded wallet.
- If the faucet answers 429 (rate limited), ask the Sui booth or a teammate for testnet SUI.
- Import the maker and taker keys into Slush (Settings → Accounts → Import private key) and switch Slush to **Testnet**. The UI demo signs with these accounts.

- [ ] **Step 3: Verify balances**

```bash
cd /Users/xfajarr/Hackathon/ethglobal-tokyo/suijin/scripts
bun -e "import { SuiGrpcClient } from '@mysten/sui/grpc'; import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'; const c = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' }); for (const n of ['EXECUTOR','MAKER','TAKER']) { const a = Ed25519Keypair.fromSecretKey(process.env[n + '_SECRET_KEY']).toSuiAddress(); const { balance } = await c.getBalance({ owner: a }); console.log(n, a, Number(balance.balance) / 1e9, 'SUI'); }"
```
Run it from `scripts/` so Bun loads `../.env`. If it prints `undefined`, run `set -a; source ../.env; set +a` first.

Expected: EXECUTOR ≥ 2 SUI, MAKER and TAKER > 0.

---

## Phase 1: Contracts (Lane A)

All commands in this phase run from `suijin/contracts/<package>`. The first build downloads the Sui framework (about 1 minute).

### Task 3: Mock coins

**Files:**
- Create: `contracts/mock_coins/Move.toml`
- Create: `contracts/mock_coins/sources/tusd.move`
- Create: `contracts/mock_coins/sources/tjpy.move`

- [ ] **Step 1: Create `contracts/mock_coins/Move.toml`**

```toml
[package]
name = "mock_coins"
edition = "2024"

[dependencies]
```

- [ ] **Step 2: Create `contracts/mock_coins/sources/tusd.move`**

```move
/// Testnet-only dollar with an open faucet. No value.
module mock_coins::tusd;

use std::string;
use sui::balance;
use sui::coin::{Self, TreasuryCap};
use sui::coin_registry;

const EAmountTooLarge: u64 = 0;
/// 1,000,000 tUSD per call (6 decimals).
const MAX_MINT: u64 = 1_000_000_000_000;

public struct TUSD has drop {}

public struct Faucet has key {
    id: UID,
    cap: TreasuryCap<TUSD>,
}

fun init(otw: TUSD, ctx: &mut TxContext) {
    let (currency, cap) = coin_registry::new_currency_with_otw(
        otw,
        6,
        string::utf8(b"tUSD"),
        string::utf8(b"Test Dollar"),
        string::utf8(b"Testnet-only dollar for the Suijin demo. No value."),
        string::utf8(b""),
        ctx,
    );
    coin_registry::finalize_and_delete_metadata_cap(currency, ctx);
    transfer::share_object(Faucet { id: object::new(ctx), cap });
}

/// Mints into the caller's address balance.
public fun mint(faucet: &mut Faucet, amount: u64, ctx: &mut TxContext) {
    assert!(amount <= MAX_MINT, EAmountTooLarge);
    balance::send_funds(coin::mint_balance(&mut faucet.cap, amount), ctx.sender());
}
```

- [ ] **Step 3: Create `contracts/mock_coins/sources/tjpy.move`**

```move
/// Testnet-only yen with an open faucet. No value.
module mock_coins::tjpy;

use std::string;
use sui::balance;
use sui::coin::{Self, TreasuryCap};
use sui::coin_registry;

const EAmountTooLarge: u64 = 0;
/// 100,000,000 tJPY per call (6 decimals).
const MAX_MINT: u64 = 100_000_000_000_000;

public struct TJPY has drop {}

public struct Faucet has key {
    id: UID,
    cap: TreasuryCap<TJPY>,
}

fun init(otw: TJPY, ctx: &mut TxContext) {
    let (currency, cap) = coin_registry::new_currency_with_otw(
        otw,
        6,
        string::utf8(b"tJPY"),
        string::utf8(b"Test Yen"),
        string::utf8(b"Testnet-only yen for the Suijin demo. No value."),
        string::utf8(b""),
        ctx,
    );
    coin_registry::finalize_and_delete_metadata_cap(currency, ctx);
    transfer::share_object(Faucet { id: object::new(ctx), cap });
}

/// Mints into the caller's address balance.
public fun mint(faucet: &mut Faucet, amount: u64, ctx: &mut TxContext) {
    assert!(amount <= MAX_MINT, EAmountTooLarge);
    balance::send_funds(coin::mint_balance(&mut faucet.cap, amount), ctx.sender());
}
```

- [ ] **Step 4: Build**

```bash
cd contracts/mock_coins && sui move build
```
Expected: `BUILDING mock_coins` and no `error`. This uses the new `coin_registry::new_currency_with_otw` API; `coin::create_currency` is deprecated in 1.80.

- [ ] **Step 5: Commit**

```bash
git add contracts/mock_coins && git commit -m "feat(contracts): tUSD and tJPY mock coins with open faucets"
```

### Task 4: Pricing math

**Files:**
- Create: `contracts/suijin/Move.toml`
- Test: `contracts/suijin/tests/math_tests.move`
- Create: `contracts/suijin/sources/math.move`

- [ ] **Step 1: Create `contracts/suijin/Move.toml`**

```toml
[package]
name = "suijin"
edition = "2024"

[dependencies]
```

- [ ] **Step 2: Write the failing tests `contracts/suijin/tests/math_tests.move`**

```move
#[test_only]
module suijin::math_tests;

use suijin::math;

#[test]
fun fixed_rate_converts_units() {
    // 1 tUSD buys 150 tJPY (both 6 decimals): 10 tUSD -> 1,500 tJPY
    assert!(math::fixed_base_out(10_000_000, 1, 150) == 1_500_000_000, 0);
}

#[test]
fun fixed_rate_rounds_down() {
    // 7 * 1 / 3 = 2.33 -> 2
    assert!(math::fixed_base_out(7, 3, 1) == 2, 0);
}

#[test, expected_failure(abort_code = suijin::math::EZero)]
fun fixed_rate_rejects_zero_price() {
    math::fixed_base_out(10, 0, 1);
}

#[test]
fun curve_rounds_in_favour_of_maker() {
    // k = 1e12, new quote = 1_001_000, exact new base = 999_000.999 -> ceil 999_001 -> out 999
    assert!(math::curve_base_out(1_000, 1_000_000, 1_000_000, 0) == 999, 0);
}

#[test]
fun curve_takes_fee_from_input() {
    // effective in = 9_970, new quote = 1_009_970, new base = ceil(990_128.4) = 990_129 -> out 9_871
    assert!(math::curve_base_out(10_000, 1_000_000, 1_000_000, 30) == 9_871, 0);
}

#[test]
fun curve_handles_max_u64_without_overflow() {
    let max = 18_446_744_073_709_551_615;
    // new base = ceil((2^64 - 1) / 2) = 2^63 -> out = 2^63 - 1
    assert!(math::curve_base_out(max, max, max, 0) == 9_223_372_036_854_775_807, 0);
}

#[test, expected_failure(abort_code = suijin::math::EFeeTooHigh)]
fun curve_rejects_full_fee() {
    math::curve_base_out(1, 1, 1, 10_000);
}
```

- [ ] **Step 3: Run them to verify they fail**

```bash
cd contracts/suijin && sui move test math_tests
```
Expected: FAIL with `error[EC03002]: unbound module` (`suijin::math` does not exist yet).

- [ ] **Step 4: Implement `contracts/suijin/sources/math.move`**

```move
/// Pure pricing math. Inputs are u64; everything is computed in u128 so nothing overflows.
module suijin::math;

const BPS: u64 = 10_000;
const MAX_U64: u128 = 18_446_744_073_709_551_615;

const EZero: u64 = 0;
const EFeeTooHigh: u64 = 1;
const EOverflow: u64 = 2;

public fun bps(): u64 { BPS }

/// Fixed rate: `price_num` quote units buy `price_den` base units. Rounds down (maker-favoured).
public fun fixed_base_out(quote_in: u64, price_num: u64, price_den: u64): u64 {
    assert!(price_num > 0 && price_den > 0, EZero);
    let out = (quote_in as u128) * (price_den as u128) / (price_num as u128);
    assert!(out <= MAX_U64, EOverflow);
    (out as u64)
}

/// Constant product on virtual reserves; the fee is taken from the input.
/// The new base reserve rounds UP, so rounding dust stays with the maker.
public fun curve_base_out(quote_in: u64, virtual_base: u64, virtual_quote: u64, fee_bps: u64): u64 {
    assert!(virtual_base > 0 && virtual_quote > 0, EZero);
    assert!(fee_bps < BPS, EFeeTooHigh);
    let effective_in = (quote_in as u128) * ((BPS - fee_bps) as u128) / (BPS as u128);
    let k = (virtual_base as u128) * (virtual_quote as u128);
    let new_base = ceil_div(k, (virtual_quote as u128) + effective_in);
    (((virtual_base as u128) - new_base) as u64)
}

fun ceil_div(a: u128, b: u128): u128 {
    let q = a / b;
    if (a % b == 0) q else q + 1
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
sui move test math_tests
```
Expected: `Test result: OK. Total tests: 7; passed: 7; failed: 0`

- [ ] **Step 6: Commit**

```bash
git add contracts/suijin && git commit -m "feat(contracts): maker-favoured fixed and curve math in u128"
```

### Task 5: App binding and protocol config

**Files:**
- Test: `contracts/suijin/tests/app_tests.move`
- Create: `contracts/suijin/sources/app.move`

- [ ] **Step 1: Write the failing tests `contracts/suijin/tests/app_tests.move`**

This file also exports `setup()` and the `JPY` and `USD` test coins, which later test files reuse.

```move
#[test_only]
module suijin::app_tests;

use std::string;
use sui::allowance;
use sui::balance::{Self, Balance};
use sui::test_scenario::{Self as ts, Scenario};
use suijin::app::{Self, App, ProtocolConfig};

/// Test coins. Base = what makers sell, Quote = what takers pay.
public struct JPY has drop {}
public struct USD has drop {}

const EXEC: address = @0xE;
const MAKER: address = @0xA;
const OTHER: address = @0xC;
/// 1,000,000 tJPY (6 decimals)
const INVENTORY: u64 = 1_000_000_000_000;
/// Clocks start at 0 ms in tests.
const EXPIRY: u64 = 1_000_000;

/// Publish as EXEC, then give MAKER inventory and an app-bound allowance over all of it.
public fun setup(): Scenario {
    let mut sc = ts::begin(EXEC);
    app::init_for_testing(sc.ctx());
    sc.next_tx(MAKER);
    balance::send_funds(balance::create_for_testing<JPY>(INVENTORY), MAKER);
    let config = sc.take_shared<ProtocolConfig>();
    let p = allowance::propose_for_app<Balance<JPY>, App>(
        string::utf8(b"maker inventory"), EXEC, option::some((INVENTORY as u256)),
        option::none(), option::some(EXPIRY), option::none(), sc.ctx(),
    );
    app::issue_maker_allowance(&config, p, sc.ctx());
    ts::return_shared(config);
    sc
}

#[test]
fun setup_issues_one_maker_allowance() {
    let mut sc = setup();
    sc.next_tx(MAKER);
    let a = sc.take_shared<allowance::Allowance<Balance<JPY>>>();
    assert!(allowance::funder(allowance::allowance_settings(&a)) == MAKER, 0);
    assert!(allowance::allowance_current_spend(&a) == 0, 1);
    ts::return_shared(a);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::app::EWrongSpender)]
fun maker_allowance_must_name_the_executor() {
    let mut sc = ts::begin(EXEC);
    app::init_for_testing(sc.ctx());
    sc.next_tx(MAKER);
    let config = sc.take_shared<ProtocolConfig>();
    let p = allowance::propose_for_app<Balance<JPY>, App>(
        string::utf8(b"wrong spender"), OTHER, option::some(1u256),
        option::none(), option::some(EXPIRY), option::none(), sc.ctx(),
    );
    app::issue_maker_allowance(&config, p, sc.ctx());
    ts::return_shared(config);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::app::ENoExpiry)]
fun maker_allowance_must_expire() {
    let mut sc = ts::begin(EXEC);
    app::init_for_testing(sc.ctx());
    sc.next_tx(MAKER);
    let config = sc.take_shared<ProtocolConfig>();
    let p = allowance::propose_for_app<Balance<JPY>, App>(
        string::utf8(b"no expiry"), EXEC, option::none(),
        option::none(), option::none(), option::some(allowance::periodic_rate_limit(3_600_000, 1)), sc.ctx(),
    );
    app::issue_maker_allowance(&config, p, sc.ctx());
    ts::return_shared(config);
    sc.end();
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
sui move test app_tests
```
Expected: FAIL with `error[EC03002]: unbound module` (`suijin::app`).

- [ ] **Step 3: Implement `contracts/suijin/sources/app.move`**

`spend` and `issue` are `public(package)`: no caller outside suijin can obtain a `SpendPermit` or `SettingsPermit` (spec PRO-002, PRO-003). The publisher becomes the executor (D8).

```move
/// Binds Sui Allowances to this package and holds the protocol config.
/// Only this module can mint allowance permits, so every spend goes through suijin's rules.
module suijin::app;

use std::internal;
use sui::allowance::{Self, Allowance, AllowanceProposal, AllowanceWithdrawal};
use sui::balance::Balance;
use sui::clock::Clock;

const EWrongSpender: u64 = 0;
const ENotFunder: u64 = 1;
const ENoExpiry: u64 = 2;
const EPaused: u64 = 3;

/// Witness type that binds allowances to this package.
public struct App has drop {}

/// Shared. `executor` is the only address that can settle fills. Set to the publisher.
public struct ProtocolConfig has key {
    id: UID,
    executor: address,
    paused: bool,
}

/// Held by the publisher. Can pause new fills; cannot move funds.
public struct AdminCap has key, store { id: UID }

fun init(ctx: &mut TxContext) {
    transfer::share_object(ProtocolConfig { id: object::new(ctx), executor: ctx.sender(), paused: false });
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

public fun executor(config: &ProtocolConfig): address { config.executor }

public fun is_paused(config: &ProtocolConfig): bool { config.paused }

public fun set_paused(_: &AdminCap, config: &mut ProtocolConfig, paused: bool) {
    config.paused = paused;
}

public fun assert_live(config: &ProtocolConfig) {
    assert!(!config.paused, EPaused);
}

/// Maker entry point. Call in the same PTB right after
/// `0x2::allowance::propose_for_app<Balance<C>, App>` with spender = executor.
public fun issue_maker_allowance<C>(
    config: &ProtocolConfig,
    proposal: AllowanceProposal<Balance<C>>,
    ctx: &mut TxContext,
) {
    check_proposal(config, &proposal, ctx);
    issue(proposal, ctx);
}

public(package) fun check_proposal<T>(
    config: &ProtocolConfig,
    proposal: &AllowanceProposal<T>,
    ctx: &TxContext,
) {
    let s = allowance::allowance_proposal_settings(proposal);
    assert!(allowance::funder(s) == ctx.sender(), ENotFunder);
    assert!(allowance::spender(s) == option::some(config.executor), EWrongSpender);
    assert!(allowance::expiration_timestamp_ms(s).is_some(), ENoExpiry);
}

public(package) fun issue<T>(proposal: AllowanceProposal<T>, ctx: &mut TxContext) {
    allowance::issue(proposal, allowance::settings_permit(internal::permit<App>()), ctx)
}

/// The only spend path. `public(package)`: callers outside suijin can never get a permit.
public(package) fun spend<C>(
    a: &mut Allowance<Balance<C>>,
    w: AllowanceWithdrawal<Balance<C>>,
    clock: &Clock,
    ctx: &TxContext,
): Balance<C> {
    allowance::app_balance_spend(a, allowance::spend_permit(internal::permit<App>()), w, clock, ctx)
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
sui move test app_tests
```
Expected: `Test result: OK. Total tests: 3; passed: 3; failed: 0`

- [ ] **Step 5: Commit**

```bash
git add contracts/suijin && git commit -m "feat(contracts): app-bound allowance issuance and the only spend path"
```

### Task 6: Strategies

**Files:**
- Test: `contracts/suijin/tests/strategy_tests.move`
- Create: `contracts/suijin/sources/strategy.move`

- [ ] **Step 1: Write the failing tests `contracts/suijin/tests/strategy_tests.move`**

```move
#[test_only]
module suijin::strategy_tests;

use sui::allowance::{Self, Allowance};
use sui::balance::Balance;
use sui::clock;
use sui::test_scenario::{Self as ts, Scenario};
use suijin::app_tests::{Self, JPY, USD};
use suijin::strategy::{Self, Strategy};

const MAKER: address = @0xA;
const OTHER: address = @0xC;
const INVENTORY: u64 = 1_000_000_000_000;
const EXPIRY: u64 = 1_000_000;

/// Fixed rate: 1 tUSD buys 150 tJPY. Returns the strategy id.
public fun create_fixed(sc: &mut Scenario, sender: address): ID {
    sc.next_tx(sender);
    let a = sc.take_shared<Allowance<Balance<JPY>>>();
    let clk = clock::create_for_testing(sc.ctx());
    strategy::create_fixed<JPY, USD>(&a, 1, 150, INVENTORY, INVENTORY, EXPIRY, &clk, sc.ctx());
    ts::return_shared(a);
    clk.destroy_for_testing();
    sc.next_tx(sender);
    ts::most_recent_id_shared<Strategy<JPY, USD>>().destroy_some()
}

/// Virtual pool: 1,000,000 tJPY vs 6,666.666666 tUSD (about 150 tJPY per tUSD), 30 bps fee.
public fun create_curve(sc: &mut Scenario): ID {
    sc.next_tx(MAKER);
    let a = sc.take_shared<Allowance<Balance<JPY>>>();
    let clk = clock::create_for_testing(sc.ctx());
    strategy::create_curve<JPY, USD>(&a, INVENTORY, 6_666_666_666, 30, INVENTORY, INVENTORY, EXPIRY, &clk, sc.ctx());
    ts::return_shared(a);
    clk.destroy_for_testing();
    sc.next_tx(MAKER);
    ts::most_recent_id_shared<Strategy<JPY, USD>>().destroy_some()
}

#[test]
fun two_strategies_share_one_allowance() {
    let mut sc = app_tests::setup();
    let fixed_id = create_fixed(&mut sc, MAKER);
    let curve_id = create_curve(&mut sc);
    sc.next_tx(MAKER);
    let a = sc.take_shared<Allowance<Balance<JPY>>>();
    let fixed = sc.take_shared_by_id<Strategy<JPY, USD>>(fixed_id);
    let curve = sc.take_shared_by_id<Strategy<JPY, USD>>(curve_id);
    assert!(fixed.maker_allowance_id() == object::id(&a), 0);
    assert!(curve.maker_allowance_id() == object::id(&a), 1);
    // creating strategies moved nothing
    assert!(allowance::allowance_current_spend(&a) == 0, 2);
    ts::return_shared(a);
    ts::return_shared(fixed);
    ts::return_shared(curve);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::strategy::ENotMaker)]
fun strategy_on_someone_elses_allowance_fails() {
    let mut sc = app_tests::setup();
    create_fixed(&mut sc, OTHER);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::strategy::ENotMaker)]
fun only_maker_can_pause() {
    let mut sc = app_tests::setup();
    let id = create_fixed(&mut sc, MAKER);
    sc.next_tx(OTHER);
    let mut s = sc.take_shared_by_id<Strategy<JPY, USD>>(id);
    s.set_active(false, sc.ctx());
    ts::return_shared(s);
    sc.end();
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
sui move test strategy_tests
```
Expected: FAIL with `error[EC03002]: unbound module` (`suijin::strategy`).

- [ ] **Step 3: Implement `contracts/suijin/sources/strategy.move`**

```move
/// A pricing strategy that quotes against a maker's allowance-backed inventory.
/// Many strategies can point at the same allowance: that is the shared liquidity.
module suijin::strategy;

use sui::allowance::{Self, Allowance};
use sui::balance::Balance;
use sui::clock::Clock;
use sui::event;
use suijin::math;

const KIND_FIXED: u8 = 0;
const KIND_CURVE: u8 = 1;

const ENotMaker: u64 = 0;
const EInvalidParams: u64 = 1;
const EExpired: u64 = 2;
const EInactive: u64 = 3;
const EZeroOutput: u64 = 4;
const EExceedsPerFill: u64 = 5;
const EExceedsVirtualLimit: u64 = 6;

public struct Strategy<phantom Base, phantom Quote> has key {
    id: UID,
    maker: address,
    maker_allowance_id: ID,
    kind: u8,
    active: bool,
    expiry_ms: u64,
    max_base_per_fill: u64,
    virtual_base_remaining: u64,
    price_num: u64,
    price_den: u64,
    virtual_base: u64,
    virtual_quote: u64,
    fee_bps: u64,
    fill_count: u64,
    base_filled: u64,
    quote_received: u64,
}

public struct StrategyCreated<phantom Base, phantom Quote> has copy, drop {
    strategy_id: ID,
    maker: address,
    allowance_id: ID,
    kind: u8,
}

public struct StrategyStatusChanged has copy, drop {
    strategy_id: ID,
    active: bool,
}

/// `price_num` quote units buy `price_den` base units.
public fun create_fixed<Base, Quote>(
    maker_allowance: &Allowance<Balance<Base>>,
    price_num: u64,
    price_den: u64,
    max_base_per_fill: u64,
    virtual_base_limit: u64,
    expiry_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(price_num > 0 && price_den > 0, EInvalidParams);
    share_new<Base, Quote>(
        maker_allowance, KIND_FIXED, max_base_per_fill, virtual_base_limit, expiry_ms,
        price_num, price_den, 0, 0, 0, clock, ctx,
    );
}

public fun create_curve<Base, Quote>(
    maker_allowance: &Allowance<Balance<Base>>,
    virtual_base: u64,
    virtual_quote: u64,
    fee_bps: u64,
    max_base_per_fill: u64,
    virtual_base_limit: u64,
    expiry_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(virtual_base > 0 && virtual_quote > 0 && fee_bps < math::bps(), EInvalidParams);
    share_new<Base, Quote>(
        maker_allowance, KIND_CURVE, max_base_per_fill, virtual_base_limit, expiry_ms,
        0, 0, virtual_base, virtual_quote, fee_bps, clock, ctx,
    );
}

/// Maker-only pause and resume.
public fun set_active<Base, Quote>(self: &mut Strategy<Base, Quote>, active: bool, ctx: &TxContext) {
    assert!(ctx.sender() == self.maker, ENotMaker);
    self.active = active;
    event::emit(StrategyStatusChanged { strategy_id: object::id(self), active });
}

/// Base out for `quote_in` at the current state. No status or limit checks.
public fun quote<Base, Quote>(self: &Strategy<Base, Quote>, quote_in: u64): u64 {
    if (self.kind == KIND_FIXED) {
        math::fixed_base_out(quote_in, self.price_num, self.price_den)
    } else {
        math::curve_base_out(quote_in, self.virtual_base, self.virtual_quote, self.fee_bps)
    }
}

public(package) fun assert_can_fill<Base, Quote>(self: &Strategy<Base, Quote>, base_out: u64, now_ms: u64) {
    assert!(self.active, EInactive);
    assert!(now_ms < self.expiry_ms, EExpired);
    assert!(base_out > 0, EZeroOutput);
    assert!(base_out <= self.max_base_per_fill, EExceedsPerFill);
    assert!(base_out <= self.virtual_base_remaining, EExceedsVirtualLimit);
}

public(package) fun record_fill<Base, Quote>(self: &mut Strategy<Base, Quote>, quote_in: u64, base_out: u64) {
    self.virtual_base_remaining = self.virtual_base_remaining - base_out;
    if (self.kind == KIND_CURVE) {
        self.virtual_base = self.virtual_base - base_out;
        self.virtual_quote = self.virtual_quote + quote_in;
    };
    self.fill_count = self.fill_count + 1;
    self.base_filled = self.base_filled + base_out;
    self.quote_received = self.quote_received + quote_in;
}

fun share_new<Base, Quote>(
    maker_allowance: &Allowance<Balance<Base>>,
    kind: u8,
    max_base_per_fill: u64,
    virtual_base_limit: u64,
    expiry_ms: u64,
    price_num: u64,
    price_den: u64,
    virtual_base: u64,
    virtual_quote: u64,
    fee_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maker = allowance::funder(allowance::allowance_settings(maker_allowance));
    assert!(maker == ctx.sender(), ENotMaker);
    assert!(max_base_per_fill > 0 && max_base_per_fill <= virtual_base_limit, EInvalidParams);
    assert!(expiry_ms > clock.timestamp_ms(), EExpired);
    let s = Strategy<Base, Quote> {
        id: object::new(ctx),
        maker,
        maker_allowance_id: object::id(maker_allowance),
        kind,
        active: true,
        expiry_ms,
        max_base_per_fill,
        virtual_base_remaining: virtual_base_limit,
        price_num,
        price_den,
        virtual_base,
        virtual_quote,
        fee_bps,
        fill_count: 0,
        base_filled: 0,
        quote_received: 0,
    };
    event::emit(StrategyCreated<Base, Quote> {
        strategy_id: object::id(&s),
        maker,
        allowance_id: s.maker_allowance_id,
        kind,
    });
    transfer::share_object(s);
}

public fun kind_fixed(): u8 { KIND_FIXED }

public fun kind_curve(): u8 { KIND_CURVE }

public fun maker<Base, Quote>(self: &Strategy<Base, Quote>): address { self.maker }

public fun maker_allowance_id<Base, Quote>(self: &Strategy<Base, Quote>): ID { self.maker_allowance_id }

public fun kind<Base, Quote>(self: &Strategy<Base, Quote>): u8 { self.kind }

public fun is_active<Base, Quote>(self: &Strategy<Base, Quote>): bool { self.active }

public fun virtual_base_remaining<Base, Quote>(self: &Strategy<Base, Quote>): u64 { self.virtual_base_remaining }

public fun virtual_base<Base, Quote>(self: &Strategy<Base, Quote>): u64 { self.virtual_base }

public fun virtual_quote<Base, Quote>(self: &Strategy<Base, Quote>): u64 { self.virtual_quote }

public fun fill_count<Base, Quote>(self: &Strategy<Base, Quote>): u64 { self.fill_count }

public fun base_filled<Base, Quote>(self: &Strategy<Base, Quote>): u64 { self.base_filled }

public fun quote_received<Base, Quote>(self: &Strategy<Base, Quote>): u64 { self.quote_received }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
sui move test strategy_tests
```
Expected: `Test result: OK. Total tests: 3; passed: 3; failed: 0`

- [ ] **Step 5: Commit**

```bash
git add contracts/suijin && git commit -m "feat(contracts): fixed and curve strategies sharing one maker allowance"
```

### Task 7: Orders

**Files:**
- Test: `contracts/suijin/tests/order_tests.move`
- Create: `contracts/suijin/sources/order.move`

- [ ] **Step 1: Write the failing tests `contracts/suijin/tests/order_tests.move`**

```move
#[test_only]
module suijin::order_tests;

use std::string;
use sui::allowance;
use sui::balance::{Self, Balance};
use sui::clock;
use sui::test_scenario::{Self as ts, Scenario};
use suijin::app::{App, ProtocolConfig};
use suijin::app_tests::{Self, JPY, USD};
use suijin::order::{Self, SwapOrder};
use suijin::strategy_tests;

const EXEC: address = @0xE;
const MAKER: address = @0xA;
const TAKER: address = @0xB;
const OTHER: address = @0xC;
/// 10 tUSD (6 decimals)
const QUOTE_IN: u64 = 10_000_000;
/// 10 tUSD at 1 tUSD = 150 tJPY
const FIXED_OUT: u64 = 1_500_000_000;
const EXPIRY: u64 = 1_000_000;

/// TAKER funds tUSD, proposes a payment allowance (cap, spender) and opens an order in one tx.
public fun place_order(sc: &mut Scenario, strategy_id: ID, cap: u64, spender: address, min_base_out: u64): ID {
    sc.next_tx(TAKER);
    balance::send_funds(balance::create_for_testing<USD>(QUOTE_IN), TAKER);
    let config = sc.take_shared<ProtocolConfig>();
    let clk = clock::create_for_testing(sc.ctx());
    let p = allowance::propose_for_app<Balance<USD>, App>(
        string::utf8(b"order payment"), spender, option::some((cap as u256)),
        option::none(), option::some(EXPIRY), option::none(), sc.ctx(),
    );
    order::create<JPY, USD>(
        &config, p, strategy_id, QUOTE_IN, min_base_out, min_base_out, EXPIRY, TAKER, &clk, sc.ctx(),
    );
    ts::return_shared(config);
    clk.destroy_for_testing();
    sc.next_tx(TAKER);
    ts::most_recent_id_shared<SwapOrder<JPY, USD>>().destroy_some()
}

#[test]
fun taker_can_cancel_open_order() {
    let mut sc = app_tests::setup();
    let sid = strategy_tests::create_fixed(&mut sc, MAKER);
    let oid = place_order(&mut sc, sid, QUOTE_IN, EXEC, FIXED_OUT);
    sc.next_tx(TAKER);
    let mut o = sc.take_shared_by_id<SwapOrder<JPY, USD>>(oid);
    o.cancel(sc.ctx());
    assert!(o.status() == order::status_cancelled(), 0);
    ts::return_shared(o);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::order::ENotTaker)]
fun only_taker_can_cancel() {
    let mut sc = app_tests::setup();
    let sid = strategy_tests::create_fixed(&mut sc, MAKER);
    let oid = place_order(&mut sc, sid, QUOTE_IN, EXEC, FIXED_OUT);
    sc.next_tx(OTHER);
    let mut o = sc.take_shared_by_id<SwapOrder<JPY, USD>>(oid);
    o.cancel(sc.ctx());
    ts::return_shared(o);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::order::EWrongCap)]
fun order_rejects_loose_payment_cap() {
    let mut sc = app_tests::setup();
    let sid = strategy_tests::create_fixed(&mut sc, MAKER);
    place_order(&mut sc, sid, QUOTE_IN + 1, EXEC, FIXED_OUT);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::app::EWrongSpender)]
fun order_rejects_payment_to_wrong_spender() {
    let mut sc = app_tests::setup();
    let sid = strategy_tests::create_fixed(&mut sc, MAKER);
    place_order(&mut sc, sid, QUOTE_IN, OTHER, FIXED_OUT);
    sc.end();
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
sui move test order_tests
```
Expected: FAIL with `error[EC03002]: unbound module` (`suijin::order`).

- [ ] **Step 3: Implement `contracts/suijin/sources/order.move`**

```move
/// A taker's swap order. Created in the same PTB as the taker's one-shot payment allowance.
module suijin::order;

use sui::allowance::{Self, AllowanceProposal};
use sui::balance::Balance;
use sui::clock::Clock;
use sui::event;
use suijin::app::{Self, ProtocolConfig};

const STATUS_OPEN: u8 = 0;
const STATUS_FILLED: u8 = 1;
const STATUS_CANCELLED: u8 = 2;

const EZeroInput: u64 = 0;
const EExpired: u64 = 1;
const EWrongCap: u64 = 2;
const EWrongExpiry: u64 = 3;
const ENotTaker: u64 = 4;
const ENotOpen: u64 = 5;

public struct SwapOrder<phantom Base, phantom Quote> has key {
    id: UID,
    taker: address,
    recipient: address,
    strategy_id: ID,
    quote_in: u64,
    min_base_out: u64,
    quoted_base_out: u64,
    expiry_ms: u64,
    status: u8,
}

public struct OrderCreated<phantom Base, phantom Quote> has copy, drop {
    order_id: ID,
    taker: address,
    strategy_id: ID,
    quote_in: u64,
    min_base_out: u64,
    expiry_ms: u64,
}

public struct OrderCancelled has copy, drop {
    order_id: ID,
}

/// Taker entry point. Call right after `0x2::allowance::propose_for_app<Balance<Quote>, App>`
/// with spender = executor, lifetime_cap = quote_in and expiration = expiry_ms.
public fun create<Base, Quote>(
    config: &ProtocolConfig,
    payment: AllowanceProposal<Balance<Quote>>,
    strategy_id: ID,
    quote_in: u64,
    min_base_out: u64,
    quoted_base_out: u64,
    expiry_ms: u64,
    recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(quote_in > 0, EZeroInput);
    assert!(expiry_ms > clock.timestamp_ms(), EExpired);
    app::check_proposal(config, &payment, ctx);
    let s = allowance::allowance_proposal_settings(&payment);
    assert!(allowance::lifetime_cap(s) == option::some((quote_in as u256)), EWrongCap);
    assert!(allowance::expiration_timestamp_ms(s) == option::some(expiry_ms), EWrongExpiry);
    app::issue(payment, ctx);
    let order = SwapOrder<Base, Quote> {
        id: object::new(ctx),
        taker: ctx.sender(),
        recipient,
        strategy_id,
        quote_in,
        min_base_out,
        quoted_base_out,
        expiry_ms,
        status: STATUS_OPEN,
    };
    event::emit(OrderCreated<Base, Quote> {
        order_id: object::id(&order),
        taker: order.taker,
        strategy_id,
        quote_in,
        min_base_out,
        expiry_ms,
    });
    transfer::share_object(order);
}

/// Taker-only. The payment allowance stays inert: only `settlement::fill` can spend it.
public fun cancel<Base, Quote>(self: &mut SwapOrder<Base, Quote>, ctx: &TxContext) {
    assert!(ctx.sender() == self.taker, ENotTaker);
    assert!(self.status == STATUS_OPEN, ENotOpen);
    self.status = STATUS_CANCELLED;
    event::emit(OrderCancelled { order_id: object::id(self) });
}

public(package) fun assert_fillable<Base, Quote>(self: &SwapOrder<Base, Quote>, now_ms: u64) {
    assert!(self.status == STATUS_OPEN, ENotOpen);
    assert!(now_ms < self.expiry_ms, EExpired);
}

public(package) fun mark_filled<Base, Quote>(self: &mut SwapOrder<Base, Quote>) {
    self.status = STATUS_FILLED;
}

public fun taker<Base, Quote>(self: &SwapOrder<Base, Quote>): address { self.taker }

public fun recipient<Base, Quote>(self: &SwapOrder<Base, Quote>): address { self.recipient }

public fun strategy_id<Base, Quote>(self: &SwapOrder<Base, Quote>): ID { self.strategy_id }

public fun quote_in<Base, Quote>(self: &SwapOrder<Base, Quote>): u64 { self.quote_in }

public fun min_base_out<Base, Quote>(self: &SwapOrder<Base, Quote>): u64 { self.min_base_out }

public fun expiry_ms<Base, Quote>(self: &SwapOrder<Base, Quote>): u64 { self.expiry_ms }

public fun status<Base, Quote>(self: &SwapOrder<Base, Quote>): u8 { self.status }

public fun status_open(): u8 { STATUS_OPEN }

public fun status_filled(): u8 { STATUS_FILLED }

public fun status_cancelled(): u8 { STATUS_CANCELLED }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
sui move test order_tests
```
Expected: `Test result: OK. Total tests: 4; passed: 4; failed: 0`

- [ ] **Step 5: Commit**

```bash
git add contracts/suijin && git commit -m "feat(contracts): swap orders with exact-cap payment allowances"
```

### Task 8: Settlement

**Files:**
- Test: `contracts/suijin/tests/settlement_tests.move`
- Create: `contracts/suijin/sources/settlement.move`

- [ ] **Step 1: Write the failing tests `contracts/suijin/tests/settlement_tests.move`**

`allowance::new_withdrawal_for_testing` stands in for the PTB withdrawal input. Address balances work inside `test_scenario` (verified).

```move
#[test_only]
module suijin::settlement_tests;

use sui::allowance::{Self, Allowance};
use sui::balance::Balance;
use sui::clock;
use sui::test_scenario::{Self as ts, Scenario};
use suijin::app::{Self, AdminCap, ProtocolConfig};
use suijin::app_tests::{Self, JPY, USD};
use suijin::order::{Self, SwapOrder};
use suijin::order_tests;
use suijin::settlement;
use suijin::strategy::Strategy;
use suijin::strategy_tests;

const EXEC: address = @0xE;
const MAKER: address = @0xA;
const TAKER: address = @0xB;
const INVENTORY: u64 = 1_000_000_000_000;
const QUOTE_IN: u64 = 10_000_000;
const FIXED_OUT: u64 = 1_500_000_000;
const EXPIRY: u64 = 1_000_000;

/// Settles `order_id` against `strategy_id`, pulling `base_amount` from MAKER and `quote_amount` from TAKER.
fun fill(sc: &mut Scenario, sender: address, strategy_id: ID, order_id: ID, base_amount: u64, quote_amount: u64, now: u64) {
    sc.next_tx(sender);
    let config = sc.take_shared<ProtocolConfig>();
    let mut s = sc.take_shared_by_id<Strategy<JPY, USD>>(strategy_id);
    let mut o = sc.take_shared_by_id<SwapOrder<JPY, USD>>(order_id);
    let mut ma = sc.take_shared<Allowance<Balance<JPY>>>();
    let mut ta = sc.take_shared<Allowance<Balance<USD>>>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(now);
    let mw = allowance::new_withdrawal_for_testing<Balance<JPY>>(object::id(&ma), MAKER, (base_amount as u256));
    let tw = allowance::new_withdrawal_for_testing<Balance<USD>>(object::id(&ta), TAKER, (quote_amount as u256));
    settlement::fill(&config, &mut s, &mut o, &mut ma, mw, &mut ta, tw, &clk, sc.ctx());
    ts::return_shared(config);
    ts::return_shared(s);
    ts::return_shared(o);
    ts::return_shared(ma);
    ts::return_shared(ta);
    clk.destroy_for_testing();
}

/// setup + fixed strategy + open order for 10 tUSD. Returns (scenario, strategy id, order id).
fun ready(min_base_out: u64): (Scenario, ID, ID) {
    let mut sc = app_tests::setup();
    let sid = strategy_tests::create_fixed(&mut sc, MAKER);
    let oid = order_tests::place_order(&mut sc, sid, QUOTE_IN, EXEC, min_base_out);
    (sc, sid, oid)
}

#[test]
fun fixed_fill_settles_both_sides() {
    let (mut sc, sid, oid) = ready(FIXED_OUT);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT, QUOTE_IN, 1);
    let effects = sc.next_tx(EXEC);
    assert!(effects.num_user_events() == 1, 0); // one Fill event
    let s = sc.take_shared_by_id<Strategy<JPY, USD>>(sid);
    let o = sc.take_shared_by_id<SwapOrder<JPY, USD>>(oid);
    let ma = sc.take_shared<Allowance<Balance<JPY>>>();
    let ta = sc.take_shared<Allowance<Balance<USD>>>();
    assert!(o.status() == order::status_filled(), 1);
    assert!(s.fill_count() == 1 && s.base_filled() == FIXED_OUT && s.quote_received() == QUOTE_IN, 2);
    assert!(s.virtual_base_remaining() == INVENTORY - FIXED_OUT, 3);
    assert!(allowance::allowance_current_spend(&ma) == (FIXED_OUT as u256), 4);
    assert!(allowance::allowance_current_spend(&ta) == (QUOTE_IN as u256), 5);
    ts::return_shared(s);
    ts::return_shared(o);
    ts::return_shared(ma);
    ts::return_shared(ta);
    sc.end();
}

#[test]
fun curve_fill_moves_virtual_reserves() {
    let mut sc = app_tests::setup();
    let sid = strategy_tests::create_curve(&mut sc);
    sc.next_tx(TAKER);
    let s = sc.take_shared_by_id<Strategy<JPY, USD>>(sid);
    let out = s.quote(QUOTE_IN);
    let (vb, vq) = (s.virtual_base(), s.virtual_quote());
    ts::return_shared(s);
    let oid = order_tests::place_order(&mut sc, sid, QUOTE_IN, EXEC, out);
    fill(&mut sc, EXEC, sid, oid, out, QUOTE_IN, 1);
    sc.next_tx(EXEC);
    let s = sc.take_shared_by_id<Strategy<JPY, USD>>(sid);
    assert!(s.virtual_base() == vb - out, 0);
    assert!(s.virtual_quote() == vq + QUOTE_IN, 1);
    ts::return_shared(s);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::settlement::EWrongMakerAmount)]
fun executor_cannot_overdraw_maker() {
    let (mut sc, sid, oid) = ready(FIXED_OUT);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT + 1, QUOTE_IN, 1);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::settlement::ESlippage)]
fun fill_below_min_out_fails() {
    let (mut sc, sid, oid) = ready(FIXED_OUT + 1);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT, QUOTE_IN, 1);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::order::ENotOpen)]
fun filled_order_cannot_replay() {
    let (mut sc, sid, oid) = ready(FIXED_OUT);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT, QUOTE_IN, 1);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT, QUOTE_IN, 2);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::settlement::EWrongExecutor)]
fun only_executor_can_fill() {
    let (mut sc, sid, oid) = ready(FIXED_OUT);
    fill(&mut sc, TAKER, sid, oid, FIXED_OUT, QUOTE_IN, 1);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::order::EExpired)]
fun expired_order_cannot_fill() {
    let (mut sc, sid, oid) = ready(FIXED_OUT);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT, QUOTE_IN, EXPIRY);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::strategy::EInactive)]
fun paused_strategy_cannot_fill() {
    let (mut sc, sid, oid) = ready(FIXED_OUT);
    sc.next_tx(MAKER);
    let mut s = sc.take_shared_by_id<Strategy<JPY, USD>>(sid);
    s.set_active(false, sc.ctx());
    ts::return_shared(s);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT, QUOTE_IN, 1);
    sc.end();
}

#[test, expected_failure(abort_code = suijin::app::EPaused)]
fun paused_protocol_blocks_fills() {
    let (mut sc, sid, oid) = ready(FIXED_OUT);
    sc.next_tx(EXEC);
    let cap = sc.take_from_sender<AdminCap>();
    let mut config = sc.take_shared<ProtocolConfig>();
    app::set_paused(&cap, &mut config, true);
    ts::return_shared(config);
    sc.return_to_sender(cap);
    fill(&mut sc, EXEC, sid, oid, FIXED_OUT, QUOTE_IN, 1);
    sc.end();
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
sui move test settlement_tests
```
Expected: FAIL with `error[EC03002]: unbound module` (`suijin::settlement`).

- [ ] **Step 3: Implement `contracts/suijin/sources/settlement.move`**

This file follows the execution order in spec §13. The executor picks the withdrawal amounts, and Move checks the resulting `Balance` values against its own math (spec §13.1).

```move
/// Atomic settlement: pull both sides through their app-bound allowances and swap them.
/// Every amount and recipient is derived here; the executor only chooses when to call.
module suijin::settlement;

use sui::allowance::{Self, Allowance, AllowanceWithdrawal};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::event;
use suijin::app::{Self, ProtocolConfig};
use suijin::order::SwapOrder;
use suijin::strategy::Strategy;

const EWrongExecutor: u64 = 0;
const EWrongStrategy: u64 = 1;
const EWrongMakerAllowance: u64 = 2;
const EWrongTakerAllowance: u64 = 3;
const ESlippage: u64 = 4;
const EWrongMakerAmount: u64 = 5;
const EWrongTakerAmount: u64 = 6;

public struct Fill<phantom Base, phantom Quote> has copy, drop {
    order_id: ID,
    strategy_id: ID,
    maker: address,
    taker: address,
    recipient: address,
    quote_in: u64,
    base_out: u64,
    timestamp_ms: u64,
}

public fun fill<Base, Quote>(
    config: &ProtocolConfig,
    strategy: &mut Strategy<Base, Quote>,
    order: &mut SwapOrder<Base, Quote>,
    maker_allowance: &mut Allowance<Balance<Base>>,
    maker_withdrawal: AllowanceWithdrawal<Balance<Base>>,
    taker_allowance: &mut Allowance<Balance<Quote>>,
    taker_withdrawal: AllowanceWithdrawal<Balance<Quote>>,
    clock: &Clock,
    ctx: &TxContext,
) {
    let now = clock.timestamp_ms();
    app::assert_live(config);
    assert!(ctx.sender() == app::executor(config), EWrongExecutor);
    assert!(order.strategy_id() == object::id(strategy), EWrongStrategy);
    order.assert_fillable(now);
    assert!(object::id(maker_allowance) == strategy.maker_allowance_id(), EWrongMakerAllowance);
    assert_taker_allowance(taker_allowance, order);

    let quote_in = order.quote_in();
    let base_out = strategy.quote(quote_in);
    strategy.assert_can_fill(base_out, now);
    assert!(base_out >= order.min_base_out(), ESlippage);

    let base = app::spend(maker_allowance, maker_withdrawal, clock, ctx);
    let quote = app::spend(taker_allowance, taker_withdrawal, clock, ctx);
    assert!(base.value() == base_out, EWrongMakerAmount);
    assert!(quote.value() == quote_in, EWrongTakerAmount);

    strategy.record_fill(quote_in, base_out);
    order.mark_filled();
    let maker = strategy.maker();
    let recipient = order.recipient();
    balance::send_funds(quote, maker);
    balance::send_funds(base, recipient);
    event::emit(Fill<Base, Quote> {
        order_id: object::id(order),
        strategy_id: object::id(strategy),
        maker,
        taker: order.taker(),
        recipient,
        quote_in,
        base_out,
        timestamp_ms: now,
    });
}

/// Binds the payment allowance to this order: same taker, exact cap, same expiry.
fun assert_taker_allowance<Base, Quote>(a: &Allowance<Balance<Quote>>, order: &SwapOrder<Base, Quote>) {
    let s = allowance::allowance_settings(a);
    assert!(allowance::funder(s) == order.taker(), EWrongTakerAllowance);
    assert!(allowance::lifetime_cap(s) == option::some((order.quote_in() as u256)), EWrongTakerAllowance);
    assert!(allowance::expiration_timestamp_ms(s) == option::some(order.expiry_ms()), EWrongTakerAllowance);
}
```

- [ ] **Step 4: Run the whole suite**

```bash
sui move test
```
Expected: `Test result: OK. Total tests: 26; passed: 26; failed: 0`

- [ ] **Step 5: Commit**

```bash
git add contracts/suijin && git commit -m "feat(contracts): atomic dual-allowance settlement"
```

---

## Phase 2: SDK and scripts (Lane B)

Run the commands from `suijin/` unless a step says otherwise.

### Task 9: SDK math

**Files:**
- Test: `packages/sdk/tests/math.test.ts`
- Create: `packages/sdk/src/math.ts`

- [ ] **Step 1: Write the failing tests `packages/sdk/tests/math.test.ts`**

These are the same vectors as `math_tests.move`: TypeScript and Move must agree.

```ts
import { describe, expect, test } from 'bun:test';
import { curveBaseOut, fixedBaseOut, formatUnits, parseUnits } from '../src/math';

// Same vectors as contracts/suijin/tests/math_tests.move: TS and Move must agree.
describe('math mirrors Move', () => {
  test('fixed rate converts units', () => expect(fixedBaseOut(10_000_000n, 1n, 150n)).toBe(1_500_000_000n));
  test('fixed rate rounds down', () => expect(fixedBaseOut(7n, 3n, 1n)).toBe(2n));
  test('fixed rate rejects zero price', () => expect(() => fixedBaseOut(10n, 0n, 1n)).toThrow());
  test('curve rounds in favour of maker', () => expect(curveBaseOut(1_000n, 1_000_000n, 1_000_000n, 0n)).toBe(999n));
  test('curve takes fee from input', () => expect(curveBaseOut(10_000n, 1_000_000n, 1_000_000n, 30n)).toBe(9_871n));
  test('curve handles u64 max', () => {
    const max = 18_446_744_073_709_551_615n;
    expect(curveBaseOut(max, max, max, 0n)).toBe(9_223_372_036_854_775_807n);
  });
  test('curve rejects full fee', () => expect(() => curveBaseOut(1n, 1n, 1n, 10_000n)).toThrow());
});

describe('units', () => {
  test('parse', () => expect(parseUnits('10.5')).toBe(10_500_000n));
  test('format', () => expect(formatUnits(1_500_250_000n)).toBe('1,500.25'));
  test('reject junk', () => expect(() => parseUnits('1.2.3')).toThrow());
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/sdk && bun test tests/math.test.ts
```
Expected: FAIL with `error: Cannot find module '../src/math'`.

- [ ] **Step 3: Implement `packages/sdk/src/math.ts`**

```ts
// Mirrors contracts/suijin/sources/math.move exactly. Keep the two in sync.
export const BPS = 10_000n;

/** `priceNum` quote units buy `priceDen` base units. Rounds down. */
export function fixedBaseOut(quoteIn: bigint, priceNum: bigint, priceDen: bigint): bigint {
  if (priceNum <= 0n || priceDen <= 0n) throw new Error('price must be positive');
  return (quoteIn * priceDen) / priceNum;
}

/** Constant product on virtual reserves; new base reserve rounds up (maker-favoured). */
export function curveBaseOut(quoteIn: bigint, virtualBase: bigint, virtualQuote: bigint, feeBps: bigint): bigint {
  if (virtualBase <= 0n || virtualQuote <= 0n) throw new Error('reserves must be positive');
  if (feeBps >= BPS) throw new Error('fee too high');
  const effectiveIn = (quoteIn * (BPS - feeBps)) / BPS;
  const k = virtualBase * virtualQuote;
  const newQuote = virtualQuote + effectiveIn;
  const newBase = (k + newQuote - 1n) / newQuote;
  return virtualBase - newBase;
}

/** "1,500.25" style display for 6-decimal amounts. */
export function formatUnits(value: bigint, decimals = 6, maxFraction = 2): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = (v / scale).toLocaleString('en-US');
  const frac = (v % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** "10.5" -> 10_500_000n for 6 decimals. */
export function parseUnits(text: string, decimals = 6): bigint {
  const parts = text.trim().split('.');
  const [whole = '0', frac = ''] = parts;
  if (parts.length > 2 || !/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > decimals) {
    throw new Error(`invalid amount: ${text}`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0'));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test tests/math.test.ts
```
Expected: `10 pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
git add packages/sdk && git commit -m "feat(sdk): math mirroring Move, unit parsing"
```

### Task 10: Chain state parsers and the quote engine

**Files:**
- Test: `packages/sdk/tests/quote.test.ts`
- Create: `packages/sdk/src/state.ts`
- Create: `packages/sdk/src/quote.ts`

- [ ] **Step 1: Write the failing tests `packages/sdk/tests/quote.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { buildQuotes, sharedLiquidityRatio } from '../src/quote';
import type { AllowanceState, StrategyState } from '../src/state';

const MAKER = '0xa';
const ALLOWANCE = '0xa11';
const NOW = 1_000_000;

const strategy = (over: Partial<StrategyState>): StrategyState => ({
  id: '0x1',
  maker: MAKER,
  makerAllowanceId: ALLOWANCE,
  kind: 'fixed',
  active: true,
  expiryMs: 9_000_000n,
  maxBasePerFill: 1_000_000_000_000n,
  virtualBaseRemaining: 1_000_000_000_000n,
  priceNum: 1n,
  priceDen: 150n,
  virtualBase: 0n,
  virtualQuote: 0n,
  feeBps: 0n,
  fillCount: 0n,
  baseFilled: 0n,
  quoteReceived: 0n,
  ...over,
});

const fixed = strategy({ id: '0xf' });
const curve = strategy({ id: '0xc', kind: 'curve', virtualBase: 1_000_000_000_000n, virtualQuote: 6_666_666_666n, feeBps: 30n });

const allowance = (over: Partial<AllowanceState> = {}): AllowanceState => ({
  id: ALLOWANCE,
  funder: MAKER,
  spender: '0xe',
  app: 'pkg::app::App',
  lifetimeCap: 1_000_000_000_000n,
  expirationMs: 9_000_000n,
  currentSpend: 0n,
  ...over,
});

const input = (over: Partial<Parameters<typeof buildQuotes>[0]> = {}) => ({
  strategies: [fixed, curve],
  allowances: new Map([[ALLOWANCE, allowance()]]),
  makerBalances: new Map([[MAKER, 1_000_000_000_000n]]),
  quoteIn: 10_000_000n,
  nowMs: NOW,
  ...over,
});

describe('buildQuotes', () => {
  test('quotes both strategies against one allowance, best first', () => {
    const quotes = buildQuotes(input());
    expect(quotes.map((q) => q.strategyId)).toEqual(['0xf', '0xc']);
    expect(quotes[0]!.baseOut).toBe(1_500_000_000n);
    expect(quotes[0]!.minBaseOut).toBe(1_485_000_000n); // 1% slippage
  });

  test('skips paused and expired strategies', () => {
    const quotes = buildQuotes(input({ strategies: [strategy({ id: '0xp', active: false }), strategy({ id: '0xx', expiryMs: 1n })] }));
    expect(quotes).toEqual([]);
  });

  test('caps by real balance, not advertised availability', () => {
    const quotes = buildQuotes(input({ makerBalances: new Map([[MAKER, 1_000n]]) }));
    expect(quotes).toEqual([]);
  });

  test('caps by allowance remaining', () => {
    const spent = allowance({ currentSpend: 1_000_000_000_000n - 1_000n });
    expect(buildQuotes(input({ allowances: new Map([[ALLOWANCE, spent]]) }))).toEqual([]);
  });

  test('revoked allowance means no quote', () => {
    expect(buildQuotes(input({ allowances: new Map() }))).toEqual([]);
  });
});

describe('sharedLiquidityRatio', () => {
  test('two strategies over one inventory = 2x', () => {
    expect(sharedLiquidityRatio([fixed, curve], 1_000_000_000_000n)).toBe(2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/sdk && bun test tests/quote.test.ts
```
Expected: FAIL with `error: Cannot find module '../src/quote'`.

- [ ] **Step 3: Implement `packages/sdk/src/state.ts`**

These parsers follow the live GraphQL JSON shape (verified 2026-09-26): u64 and u256 arrive as strings, `Option` arrives as a value or `null`, and `TypeName` as `pkg::module::Name`.

```ts
import { curveBaseOut, fixedBaseOut } from './math';

// Parsers for GraphQL `contents.json`: u64/u256 arrive as strings, Option as value-or-null.
const big = (v: unknown) => BigInt(String(v ?? 0));
const optBig = (v: unknown) => (v === null || v === undefined ? null : BigInt(String(v)));

export type StrategyState = {
  id: string;
  maker: string;
  makerAllowanceId: string;
  kind: 'fixed' | 'curve';
  active: boolean;
  expiryMs: bigint;
  maxBasePerFill: bigint;
  virtualBaseRemaining: bigint;
  priceNum: bigint;
  priceDen: bigint;
  virtualBase: bigint;
  virtualQuote: bigint;
  feeBps: bigint;
  fillCount: bigint;
  baseFilled: bigint;
  quoteReceived: bigint;
};

export function parseStrategy(json: Record<string, unknown>): StrategyState {
  return {
    id: String(json.id),
    maker: String(json.maker),
    makerAllowanceId: String(json.maker_allowance_id),
    kind: Number(json.kind) === 0 ? 'fixed' : 'curve',
    active: Boolean(json.active),
    expiryMs: big(json.expiry_ms),
    maxBasePerFill: big(json.max_base_per_fill),
    virtualBaseRemaining: big(json.virtual_base_remaining),
    priceNum: big(json.price_num),
    priceDen: big(json.price_den),
    virtualBase: big(json.virtual_base),
    virtualQuote: big(json.virtual_quote),
    feeBps: big(json.fee_bps),
    fillCount: big(json.fill_count),
    baseFilled: big(json.base_filled),
    quoteReceived: big(json.quote_received),
  };
}

/** Same math as `strategy::quote` on chain. */
export function strategyBaseOut(s: StrategyState, quoteIn: bigint): bigint {
  return s.kind === 'fixed'
    ? fixedBaseOut(quoteIn, s.priceNum, s.priceDen)
    : curveBaseOut(quoteIn, s.virtualBase, s.virtualQuote, s.feeBps);
}

export type AllowanceState = {
  id: string;
  funder: string;
  spender: string | null;
  app: string | null;
  lifetimeCap: bigint | null;
  expirationMs: bigint | null;
  currentSpend: bigint;
};

export function parseAllowance(json: Record<string, unknown>): AllowanceState {
  const s = (json.settings ?? {}) as Record<string, unknown>;
  return {
    id: String(json.id),
    funder: String(s.funder),
    spender: s.spender === null || s.spender === undefined ? null : String(s.spender),
    app: s.app === null || s.app === undefined ? null : String(s.app),
    lifetimeCap: optBig(s.lifetime_cap),
    expirationMs: optBig(s.expiration_timestamp_ms),
    currentSpend: big(json.current_spend),
  };
}

/** What is left to spend under the lifetime cap (null cap = unlimited, bounded by rate limit only). */
export function allowanceRemaining(a: AllowanceState): bigint | null {
  return a.lifetimeCap === null ? null : a.lifetimeCap - a.currentSpend;
}

export type OrderState = {
  id: string;
  taker: string;
  recipient: string;
  strategyId: string;
  quoteIn: bigint;
  minBaseOut: bigint;
  quotedBaseOut: bigint;
  expiryMs: bigint;
  status: 'open' | 'filled' | 'cancelled';
};

export function parseOrder(json: Record<string, unknown>): OrderState {
  const status = Number(json.status);
  return {
    id: String(json.id),
    taker: String(json.taker),
    recipient: String(json.recipient),
    strategyId: String(json.strategy_id),
    quoteIn: big(json.quote_in),
    minBaseOut: big(json.min_base_out),
    quotedBaseOut: big(json.quoted_base_out),
    expiryMs: big(json.expiry_ms),
    status: status === 0 ? 'open' : status === 1 ? 'filled' : 'cancelled',
  };
}
```

- [ ] **Step 4: Implement `packages/sdk/src/quote.ts`**

```ts
import { allowanceRemaining, strategyBaseOut, type AllowanceState, type StrategyState } from './state';

export type Quote = {
  strategyId: string;
  kind: 'fixed' | 'curve';
  maker: string;
  makerAllowanceId: string;
  quoteIn: bigint;
  baseOut: bigint;
  minBaseOut: bigint;
  expiresAtMs: number;
};

export type QuoteInput = {
  strategies: StrategyState[];
  allowances: Map<string, AllowanceState>;
  /** maker address -> base-coin address balance */
  makerBalances: Map<string, bigint>;
  quoteIn: bigint;
  nowMs: number;
  slippageBps?: bigint;
  ttlMs?: number;
};

/**
 * Executable quotes, best first. A strategy is skipped when paused, expired, or when its
 * output exceeds what can really settle: min(address balance, allowance remaining,
 * strategy remaining, max per fill).
 */
export function buildQuotes(input: QuoteInput): Quote[] {
  const { strategies, allowances, makerBalances, quoteIn, nowMs } = input;
  const slippageBps = input.slippageBps ?? 100n;
  const ttlMs = input.ttlMs ?? 60_000;
  const quotes: Quote[] = [];
  for (const s of strategies) {
    if (!s.active || BigInt(nowMs) >= s.expiryMs) continue;
    const allowance = allowances.get(s.makerAllowanceId);
    if (!allowance || (allowance.expirationMs !== null && BigInt(nowMs) >= allowance.expirationMs)) continue;
    let baseOut: bigint;
    try {
      baseOut = strategyBaseOut(s, quoteIn);
    } catch {
      continue;
    }
    const remaining = allowanceRemaining(allowance);
    const balance = makerBalances.get(s.maker) ?? 0n;
    const executable = [balance, s.virtualBaseRemaining, s.maxBasePerFill, ...(remaining === null ? [] : [remaining])]
      .reduce((a, b) => (a < b ? a : b));
    if (baseOut <= 0n || baseOut > executable) continue;
    quotes.push({
      strategyId: s.id,
      kind: s.kind,
      maker: s.maker,
      makerAllowanceId: s.makerAllowanceId,
      quoteIn,
      baseOut,
      minBaseOut: (baseOut * (10_000n - slippageBps)) / 10_000n,
      expiresAtMs: nowMs + ttlMs,
    });
  }
  return quotes.sort((a, b) => (b.baseOut > a.baseOut ? 1 : b.baseOut < a.baseOut ? -1 : 0));
}

/** Shared Liquidity Ratio: advertised availability over real executable inventory. Display only. */
export function sharedLiquidityRatio(strategies: StrategyState[], executableInventory: bigint): number {
  if (executableInventory <= 0n) return 0;
  const advertised = strategies
    .filter((s) => s.active)
    .reduce((sum, s) => sum + (s.virtualBaseRemaining < executableInventory ? s.virtualBaseRemaining : executableInventory), 0n);
  return Number((advertised * 100n) / executableInventory) / 100;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
bun test
```
Expected: `16 pass, 0 fail` (math + quote)

- [ ] **Step 6: Commit**

```bash
git add packages/sdk && git commit -m "feat(sdk): state parsers, executable quotes, shared liquidity ratio"
```

### Task 11: Config, transaction builders and chain reads

**Files:**
- Create: `packages/sdk/src/config.ts`, `packages/sdk/src/deployment.json`, `packages/sdk/src/tx.ts`, `packages/sdk/src/read.ts`, `packages/sdk/src/index.ts`

- [ ] **Step 1: Create `packages/sdk/src/config.ts`**

```ts
import deployment from './deployment.json' with { type: 'json' };

export type Deployment = {
  network: 'testnet' | 'devnet';
  packageId: string;
  configId: string;
  executor: string;
  mockCoinsPackageId: string;
  tusdFaucetId: string;
  tjpyFaucetId: string;
};

export const DEPLOYMENT = deployment as Deployment;

export const GRPC_URL = (d: Deployment = DEPLOYMENT) => `https://fullnode.${d.network}.sui.io:443`;
export const GRAPHQL_URL = (d: Deployment = DEPLOYMENT) => `https://graphql.${d.network}.sui.io/graphql`;

/** Fully qualified Move types for this deployment. Base = what makers sell, Quote = what takers pay. */
export const typesOf = (d: Deployment = DEPLOYMENT) => ({
  app: `${d.packageId}::app::App`,
  base: `${d.mockCoinsPackageId}::tjpy::TJPY`,
  quote: `${d.mockCoinsPackageId}::tusd::TUSD`,
  strategy: `${d.packageId}::strategy::Strategy`,
  order: `${d.packageId}::order::SwapOrder`,
  allowance: '0x2::allowance::Allowance',
  allowanceCap: (coin: string) => `0x2::allowance::AllowanceCap<0x2::balance::Balance<${coin}>>`,
});

/** Both demo coins use 6 decimals. */
export const DECIMALS = 6;
```

- [ ] **Step 2: Create the placeholder `packages/sdk/src/deployment.json`**

Task 13 overwrites this file with real IDs.

```json
{
  "network": "testnet",
  "packageId": "0x0",
  "configId": "0x0",
  "executor": "0x0",
  "mockCoinsPackageId": "0x0",
  "tusdFaucetId": "0x0",
  "tjpyFaucetId": "0x0"
}
```

- [ ] **Step 3: Create `packages/sdk/src/tx.ts`**

Every builder returns an unsigned `Transaction`:
- `propose_for_app` is a non-public `entry` function that returns a value. Its result feeds straight into our module in the same PTB (the documented pattern).
- `tx.withdrawal({ from: 'allowance' })` declares an allowance-backed input. Sui checks before execution that the sender is the spender.

```ts
import { Transaction, type TransactionResult } from '@mysten/sui/transactions';
import { DEPLOYMENT, typesOf, type Deployment } from './config';

type RateLimit = { periodMs: number; limit: bigint };

/** `0x2::allowance::propose_for_app<Balance<coin>, App>` with spender = executor. Returns the proposal. */
function propose(
  tx: Transaction,
  d: Deployment,
  coin: string,
  name: string,
  cap: bigint,
  expiresAtMs: number,
  rateLimit?: RateLimit,
): TransactionResult {
  const rl = rateLimit
    ? tx.moveCall({
        target: '0x1::option::some',
        typeArguments: ['0x2::allowance::RateLimit'],
        arguments: [
          tx.moveCall({
            target: '0x2::allowance::periodic_rate_limit',
            arguments: [tx.pure.u64(rateLimit.periodMs), tx.pure.u256(rateLimit.limit)],
          }),
        ],
      })
    : tx.moveCall({ target: '0x1::option::none', typeArguments: ['0x2::allowance::RateLimit'] });
  return tx.moveCall({
    target: '0x2::allowance::propose_for_app',
    typeArguments: [`0x2::balance::Balance<${coin}>`, typesOf(d).app],
    arguments: [
      tx.pure.string(name),
      tx.pure.address(d.executor),
      tx.pure.option('u256', cap),
      tx.pure.option('u64', null),
      tx.pure.option('u64', expiresAtMs),
      rl,
    ],
  });
}

/** Maker: app-bound allowance over base inventory. Funds do not move. */
export function issueMakerAllowance(
  p: { cap: bigint; expiresAtMs: number; rateLimit?: RateLimit },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const base = typesOf(d).base;
  const proposal = propose(tx, d, base, 'suijin maker inventory', p.cap, p.expiresAtMs, p.rateLimit);
  tx.moveCall({
    target: `${d.packageId}::app::issue_maker_allowance`,
    typeArguments: [base],
    arguments: [tx.object(d.configId), proposal],
  });
  return tx;
}

export function createFixedStrategy(
  p: { allowanceId: string; priceNum: bigint; priceDen: bigint; maxBasePerFill: bigint; virtualBaseLimit: bigint; expiresAtMs: number },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::create_fixed`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(p.allowanceId),
      tx.pure.u64(p.priceNum),
      tx.pure.u64(p.priceDen),
      tx.pure.u64(p.maxBasePerFill),
      tx.pure.u64(p.virtualBaseLimit),
      tx.pure.u64(p.expiresAtMs),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function createCurveStrategy(
  p: { allowanceId: string; virtualBase: bigint; virtualQuote: bigint; feeBps: bigint; maxBasePerFill: bigint; virtualBaseLimit: bigint; expiresAtMs: number },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::create_curve`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(p.allowanceId),
      tx.pure.u64(p.virtualBase),
      tx.pure.u64(p.virtualQuote),
      tx.pure.u64(p.feeBps),
      tx.pure.u64(p.maxBasePerFill),
      tx.pure.u64(p.virtualBaseLimit),
      tx.pure.u64(p.expiresAtMs),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function setStrategyActive(strategyId: string, active: boolean, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({
    target: `${d.packageId}::strategy::set_active`,
    typeArguments: [t.base, t.quote],
    arguments: [tx.object(strategyId), tx.pure.bool(active)],
  });
  return tx;
}

/** Taker: exact-cap payment allowance + SwapOrder in ONE transaction. Funds do not move. */
export function createTakerOrder(
  p: { strategyId: string; quoteIn: bigint; minBaseOut: bigint; quotedBaseOut: bigint; expiresAtMs: number; recipient: string },
  d: Deployment = DEPLOYMENT,
): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  const proposal = propose(tx, d, t.quote, 'suijin order payment', p.quoteIn, p.expiresAtMs);
  tx.moveCall({
    target: `${d.packageId}::order::create`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(d.configId),
      proposal,
      tx.pure.id(p.strategyId),
      tx.pure.u64(p.quoteIn),
      tx.pure.u64(p.minBaseOut),
      tx.pure.u64(p.quotedBaseOut),
      tx.pure.u64(p.expiresAtMs),
      tx.pure.address(p.recipient),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function cancelOrder(orderId: string, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.moveCall({ target: `${d.packageId}::order::cancel`, typeArguments: [t.base, t.quote], arguments: [tx.object(orderId)] });
  return tx;
}

/** Funder: deletes the allowance; every later fill against it fails. */
export function revokeAllowance(p: { coin: string; allowanceId: string; capId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: '0x2::allowance::revoke',
    typeArguments: [`0x2::balance::Balance<${p.coin}>`],
    arguments: [tx.object(p.capId), tx.object(p.allowanceId)],
  });
  return tx;
}

/** Mint demo coins into the sender's address balance. */
export function mintTestCoin(which: 'tusd' | 'tjpy', amount: bigint, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${d.mockCoinsPackageId}::${which}::mint`,
    arguments: [tx.object(which === 'tusd' ? d.tusdFaucetId : d.tjpyFaucetId), tx.pure.u64(amount)],
  });
  return tx;
}

export type FillParams = {
  strategyId: string;
  orderId: string;
  maker: string;
  makerAllowanceId: string;
  taker: string;
  takerAllowanceId: string;
  baseOut: bigint;
  quoteIn: bigint;
};

/** Executor: one PTB that pulls both sides through their allowances and swaps them. */
export function buildFill(p: FillParams, d: Deployment = DEPLOYMENT): Transaction {
  const tx = new Transaction();
  const t = typesOf(d);
  tx.setSender(d.executor);
  tx.moveCall({
    target: `${d.packageId}::settlement::fill`,
    typeArguments: [t.base, t.quote],
    arguments: [
      tx.object(d.configId),
      tx.object(p.strategyId),
      tx.object(p.orderId),
      tx.object(p.makerAllowanceId),
      tx.withdrawal({ amount: p.baseOut, type: t.base, from: 'allowance', allowance: p.makerAllowanceId, funder: p.maker }),
      tx.object(p.takerAllowanceId),
      tx.withdrawal({ amount: p.quoteIn, type: t.quote, from: 'allowance', allowance: p.takerAllowanceId, funder: p.taker }),
      tx.object.clock(),
    ],
  });
  return tx;
}
```

- [ ] **Step 4: Create `packages/sdk/src/read.ts`**

Note: owned objects in GraphQL (`address { objects }`) are already `MoveObject`, so `contents` sits directly on the node. There is no `asMoveObject` there (verified).

```ts
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { DEPLOYMENT, GRAPHQL_URL, typesOf, type Deployment } from './config';
import { parseAllowance, parseOrder, parseStrategy, type AllowanceState, type OrderState, type StrategyState } from './state';

// Object reads go through GraphQL: one stable JSON shape. Balances and execution go through gRPC.
async function gql<T>(query: string, variables: Record<string, unknown>, d: Deployment): Promise<T> {
  const res = await fetch(GRAPHQL_URL(d), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data as T;
}

type Node = { address: string; asMoveObject: { contents: { json: Record<string, unknown> } } | null };

export async function listStrategies(d: Deployment = DEPLOYMENT): Promise<StrategyState[]> {
  const data = await gql<{ objects: { nodes: Node[] } }>(
    `query ($type: String!) { objects(first: 50, filter: { type: $type }) { nodes { address asMoveObject { contents { json } } } } }`,
    { type: typesOf(d).strategy },
    d,
  );
  return data.objects.nodes.filter((n) => n.asMoveObject).map((n) => parseStrategy(n.asMoveObject!.contents.json));
}

async function objectJson(id: string, d: Deployment): Promise<Record<string, unknown> | null> {
  const data = await gql<{ object: Node | null }>(
    `query ($id: SuiAddress!) { object(address: $id) { address asMoveObject { contents { json } } } }`,
    { id },
    d,
  );
  return data.object?.asMoveObject?.contents.json ?? null;
}

export async function getStrategy(id: string, d: Deployment = DEPLOYMENT): Promise<StrategyState | null> {
  const json = await objectJson(id, d);
  return json && parseStrategy(json);
}

export async function getOrder(id: string, d: Deployment = DEPLOYMENT): Promise<OrderState | null> {
  const json = await objectJson(id, d);
  return json && parseOrder(json);
}

/** null when the allowance was revoked (object deleted). */
export async function getAllowance(id: string, d: Deployment = DEPLOYMENT): Promise<AllowanceState | null> {
  const json = await objectJson(id, d);
  return json && parseAllowance(json);
}

/** Allowances this funder issued for `coin`, found through the AllowanceCap objects they own. */
export async function listAllowanceCaps(
  owner: string,
  coin: string,
  d: Deployment = DEPLOYMENT,
): Promise<{ capId: string; allowanceId: string }[]> {
  // Owned objects come back as MoveObject already: `contents` sits directly on the node.
  type OwnedNode = { address: string; contents: { json: Record<string, unknown> } };
  const data = await gql<{ address: { objects: { nodes: OwnedNode[] } } | null }>(
    `query ($owner: SuiAddress!, $type: String!) { address(address: $owner) { objects(first: 50, filter: { type: $type }) { nodes { address contents { json } } } } }`,
    { owner, type: typesOf(d).allowanceCap(coin) },
    d,
  );
  return (data.address?.objects.nodes ?? []).map((n) => ({
    capId: n.address,
    allowanceId: String(n.contents.json.allowance),
  }));
}

/** Address-balance part only (coins held as objects are not spendable by allowances). */
export async function addressBalance(client: SuiGrpcClient, owner: string, coinType: string): Promise<bigint> {
  const { balance } = await client.getBalance({ owner, coinType });
  return BigInt(balance.addressBalance);
}
```

- [ ] **Step 5: Create `packages/sdk/src/index.ts`**

```ts
export * from './config';
export * from './math';
export * from './state';
export * from './quote';
export * from './tx';
export * from './read';
```

- [ ] **Step 6: Typecheck (this is the test for builders and readers)**

```bash
bunx tsc -p tsconfig.json
```
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk && git commit -m "feat(sdk): transaction builders and GraphQL/gRPC reads"
```

### Task 12: Deploy and end-to-end scripts (devnet proof)

**Files:**
- Create: `scripts/deploy.ts`
- Create: `scripts/e2e.ts`

Depends on: Tasks 3–8 (contracts) and 9–11 (SDK).

- [ ] **Step 1: Create `scripts/deploy.ts`**

```ts
// Publish mock_coins + suijin with the EXECUTOR key (the publisher becomes the executor).
// Usage: EXECUTOR_SECRET_KEY=suiprivkey... bun scripts/deploy.ts [testnet|devnet]
import { $ } from 'bun';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { Deployment } from '@suijin/sdk';

const ROOT = new URL('..', import.meta.url).pathname;
const SUI = process.env.SUI_BIN ?? 'sui';

async function publish(client: SuiGrpcClient, signer: Ed25519Keypair, dir: string) {
  const out = await $`${SUI} move build --dump-bytecode-as-base64 --path ${ROOT}contracts/${dir}`.quiet().text();
  const { modules, dependencies } = JSON.parse(out.slice(out.indexOf('{')));
  const tx = new Transaction();
  tx.transferObjects([tx.publish({ modules, dependencies })], signer.toSuiAddress());
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
  if (r.$kind === 'FailedTransaction') throw new Error(`publish ${dir}: ${r.FailedTransaction.status.error?.message}`);
  await client.waitForTransaction({ result: r });
  const changed = r.Transaction.effects.changedObjects;
  const types = r.Transaction.objectTypes;
  const packageId = changed.find((c) => c.outputState === 'PackageWrite')?.objectId;
  if (!packageId) throw new Error(`publish ${dir}: no package in effects`);
  const created = (suffix: string) => {
    const hit = changed.find((c) => c.idOperation === 'Created' && types[c.objectId]?.endsWith(suffix));
    if (!hit) throw new Error(`publish ${dir}: no created ${suffix}`);
    return hit.objectId;
  };
  console.log(`published ${dir}: ${packageId} (${r.Transaction.digest})`);
  return { packageId, created };
}

export async function deploy(signer: Ed25519Keypair, network: Deployment['network']): Promise<Deployment> {
  const client = new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` });
  const coins = await publish(client, signer, 'mock_coins');
  const core = await publish(client, signer, 'suijin');
  return {
    network,
    packageId: core.packageId,
    configId: core.created('::app::ProtocolConfig'),
    executor: signer.toSuiAddress(),
    mockCoinsPackageId: coins.packageId,
    tusdFaucetId: coins.created('::tusd::Faucet'),
    tjpyFaucetId: coins.created('::tjpy::Faucet'),
  };
}

if (import.meta.main) {
  const network = (process.argv[2] ?? 'testnet') as Deployment['network'];
  const secret = process.env.EXECUTOR_SECRET_KEY;
  if (!secret) throw new Error('EXECUTOR_SECRET_KEY missing');
  const d = await deploy(Ed25519Keypair.fromSecretKey(secret), network);
  await Bun.write(`${ROOT}packages/sdk/src/deployment.json`, `${JSON.stringify(d, null, 2)}\n`);
  console.log('wrote packages/sdk/src/deployment.json', d);
}
```

- [ ] **Step 2: Create `scripts/e2e.ts`**

```ts
// End-to-end proof on a live network (spec §21.3).
//   Testnet (team keys):  MAKER_SECRET_KEY=.. TAKER_SECRET_KEY=.. EXECUTOR_SECRET_KEY=.. bun scripts/e2e.ts
//   Fresh devnet run:     FRESH=1 bun scripts/e2e.ts   (new keys, faucet, fresh deploy)
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import {
  DEPLOYMENT,
  addressBalance,
  buildFill,
  buildQuotes,
  createCurveStrategy,
  createFixedStrategy,
  createTakerOrder,
  formatUnits,
  getAllowance,
  getOrder,
  getStrategy,
  issueMakerAllowance,
  listStrategies,
  mintTestCoin,
  revokeAllowance,
  typesOf,
  type Deployment,
} from '@suijin/sdk';
import { deploy } from './deploy';

const FRESH = process.env.FRESH === '1';
const key = (name: string) => {
  const secret = process.env[`${name}_SECRET_KEY`];
  if (FRESH) return new Ed25519Keypair();
  if (!secret) throw new Error(`${name}_SECRET_KEY missing`);
  return Ed25519Keypair.fromSecretKey(secret);
};
const [executor, maker, taker] = [key('EXECUTOR'), key('MAKER'), key('TAKER')];
const network: Deployment['network'] = FRESH ? 'devnet' : DEPLOYMENT.network;
const client = new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` });

const step = (msg: string) => console.log(`\n▶ ${msg}`);
function check(ok: boolean, msg: string) {
  if (!ok) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run(label: string, tx: Transaction, signer: Ed25519Keypair) {
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
  if (r.$kind === 'FailedTransaction') throw new Error(`${label}: ${r.FailedTransaction.status.error?.message}`);
  await client.waitForTransaction({ result: r });
  console.log(`  ${label}: ${r.Transaction.digest}`);
  const created = (fragment: string) =>
    r.Transaction.effects.changedObjects.find((c) => c.idOperation === 'Created' && r.Transaction.objectTypes[c.objectId]?.includes(fragment))?.objectId ?? '';
  return { digest: r.Transaction.digest, created };
}

/** GraphQL indexes a moment after the fullnode; poll until it has caught up. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 30; i++) {
    const v = await read();
    if (ok(v)) return v;
    await Bun.sleep(1000);
  }
  throw new Error('timed out waiting for the indexer');
}

let d: Deployment = DEPLOYMENT;
if (FRESH) {
  step('fresh devnet: faucet + deploy');
  await requestSuiFromFaucetV2({ host: getFaucetHost('devnet'), recipient: executor.toSuiAddress() });
  await eventually(() => client.getBalance({ owner: executor.toSuiAddress() }), (r) => BigInt(r.balance.balance) > 0n);
  const gas = new Transaction();
  const [a, b] = gas.splitCoins(gas.gas, [500_000_000n, 500_000_000n]);
  gas.transferObjects([a!], maker.toSuiAddress());
  gas.transferObjects([b!], taker.toSuiAddress());
  await run('gas for maker and taker', gas, executor);
  d = await deploy(executor, 'devnet');
}
const t = typesOf(d);
const now = Date.now();
const HOUR = 3_600_000;

step('maker mints 1,000,000 tJPY into its address balance');
await run('mint tJPY', mintTestCoin('tjpy', 1_000_000_000_000n, d), maker);
const makerJpy0 = await addressBalance(client, maker.toSuiAddress(), t.base);
console.log(`  maker tJPY: ${formatUnits(makerJpy0)}`);

step('maker issues ONE app-bound allowance over the whole inventory');
const issued = await run('issue allowance', issueMakerAllowance({ cap: 1_000_000_000_000n, expiresAtMs: now + 6 * HOUR }, d), maker);
const allowanceId = issued.created('::allowance::Allowance<');
const capId = issued.created('::allowance::AllowanceCap<');

step('maker creates TWO strategies on the same allowance');
const fixed = await run('create fixed', createFixedStrategy({ allowanceId, priceNum: 1n, priceDen: 150n, maxBasePerFill: 1_000_000_000_000n, virtualBaseLimit: 1_000_000_000_000n, expiresAtMs: now + 6 * HOUR }, d), maker);
const curve = await run('create curve', createCurveStrategy({ allowanceId, virtualBase: 1_000_000_000_000n, virtualQuote: 6_666_666_666n, feeBps: 30n, maxBasePerFill: 1_000_000_000_000n, virtualBaseLimit: 1_000_000_000_000n, expiresAtMs: now + 6 * HOUR }, d), maker);
const fixedId = fixed.created('::strategy::Strategy<');
const curveId = curve.created('::strategy::Strategy<');
check((await addressBalance(client, maker.toSuiAddress(), t.base)) === makerJpy0, 'creating strategies moved zero tJPY');

step('taker mints 100 tUSD and asks for quotes');
await run('mint tUSD', mintTestCoin('tusd', 100_000_000n, d), taker);
const strategies = await eventually(() => listStrategies(d), (s) => s.filter((x) => x.id === fixedId || x.id === curveId).length === 2);
const mine = strategies.filter((s) => s.id === fixedId || s.id === curveId);
const allowance = await eventually(() => getAllowance(allowanceId, d), (a) => a !== null);
const quotes = buildQuotes({
  strategies: mine,
  allowances: new Map([[allowanceId, allowance!]]),
  makerBalances: new Map([[maker.toSuiAddress(), makerJpy0]]),
  quoteIn: 10_000_000n,
  nowMs: Date.now(),
});
check(quotes.length === 2, `both strategies quote (${quotes.map((q) => `${q.kind}=${formatUnits(q.baseOut)}`).join(', ')})`);
const best = quotes[0]!;

step('taker signs ONE tx: exact-cap payment allowance + order');
const takerUsd0 = await addressBalance(client, taker.toSuiAddress(), t.quote);
const placed = await run(
  'create order',
  createTakerOrder({ strategyId: best.strategyId, quoteIn: best.quoteIn, minBaseOut: best.minBaseOut, quotedBaseOut: best.baseOut, expiresAtMs: Date.now() + 10 * 60_000, recipient: taker.toSuiAddress() }, d),
  taker,
);
const orderId = placed.created('::order::SwapOrder<');
const paymentId = placed.created('::allowance::Allowance<');
check((await addressBalance(client, taker.toSuiAddress(), t.quote)) === takerUsd0, 'placing the order moved zero tUSD');

step('executor settles both sides in ONE PTB');
const fill = await run(
  'fill',
  buildFill({ strategyId: best.strategyId, orderId, maker: maker.toSuiAddress(), makerAllowanceId: allowanceId, taker: taker.toSuiAddress(), takerAllowanceId: paymentId, baseOut: best.baseOut, quoteIn: best.quoteIn }, d),
  executor,
);
const order = await eventually(() => getOrder(orderId, d), (o) => o?.status === 'filled');
check(order?.status === 'filled', `order filled (${fill.digest})`);
check((await addressBalance(client, maker.toSuiAddress(), t.base)) === makerJpy0 - best.baseOut, `maker tJPY -${formatUnits(best.baseOut)}`);
check((await addressBalance(client, maker.toSuiAddress(), t.quote)) === best.quoteIn, `maker tUSD +${formatUnits(best.quoteIn)}`);
check((await addressBalance(client, taker.toSuiAddress(), t.base)) === best.baseOut, `taker tJPY +${formatUnits(best.baseOut)}`);
const chosen = await eventually(() => getStrategy(best.strategyId, d), (s) => s?.fillCount === 1n);
check(chosen?.baseFilled === best.baseOut, 'strategy recorded the fill');

step('executor tries to overdraw the maker: must abort');
const o2 = await run(
  'second order',
  createTakerOrder({ strategyId: best.strategyId, quoteIn: best.quoteIn, minBaseOut: 1n, quotedBaseOut: best.baseOut, expiresAtMs: Date.now() + 10 * 60_000, recipient: taker.toSuiAddress() }, d),
  taker,
);
const greedy = await client
  .signAndExecuteTransaction({
    transaction: buildFill({ strategyId: best.strategyId, orderId: o2.created('::order::SwapOrder<'), maker: maker.toSuiAddress(), makerAllowanceId: allowanceId, taker: taker.toSuiAddress(), takerAllowanceId: o2.created('::allowance::Allowance<'), baseOut: best.baseOut * 2n, quoteIn: best.quoteIn }, d),
    signer: executor,
  })
  .then((r) => r.$kind, (e: Error) => `rejected: ${e.message.slice(0, 80)}`);
check(greedy !== 'Transaction', `overdraw refused (${greedy})`);

step('maker revokes; the next fill must fail');
await run('revoke', revokeAllowance({ coin: t.base, allowanceId, capId }), maker);
const afterRevoke = await client
  .signAndExecuteTransaction({
    transaction: buildFill({ strategyId: best.strategyId, orderId: o2.created('::order::SwapOrder<'), maker: maker.toSuiAddress(), makerAllowanceId: allowanceId, taker: taker.toSuiAddress(), takerAllowanceId: o2.created('::allowance::Allowance<'), baseOut: best.baseOut, quoteIn: best.quoteIn }, d),
    signer: executor,
  })
  .then((r) => r.$kind, (e: Error) => `rejected: ${e.message.slice(0, 80)}`);
check(afterRevoke !== 'Transaction', `fill after revoke refused (${afterRevoke})`);

console.log('\nE2E OK');
```

- [ ] **Step 3: Typecheck**

```bash
bunx tsc -p tsconfig.json
```
Expected: exit code 0.

- [ ] **Step 4: Run the full proof on devnet with fresh keys**

```bash
FRESH=1 bun scripts/e2e.ts
```
Expected, ending with:
```
  ✓ creating strategies moved zero tJPY
  ✓ both strategies quote (fixed=1,500, curve=1,493.26)
  ✓ placing the order moved zero tUSD
  ✓ order filled (…)
  ✓ maker tJPY -1,500
  ✓ maker tUSD +10
  ✓ taker tJPY +1,500
  ✓ strategy recorded the fill
  ✓ overdraw refused (rejected: … abort code: 5 …)
  ✓ fill after revoke refused (rejected: Object … not found)

E2E OK
```
If the devnet faucet returns 429, skip ahead to Task 13: the same script runs on testnet.

- [ ] **Step 5: Commit**

```bash
git add scripts && git commit -m "feat(scripts): SDK publish and live end-to-end proof"
```

### Task 13: Testnet deployment and testnet proof

**Files:** Modify `packages/sdk/src/deployment.json` (written by the script)

Depends on: Task 2 (funded keys) and Task 12.

- [ ] **Step 1: Publish both packages with the executor key**

```bash
bun run deploy
```
Expected: `published mock_coins: 0x…`, `published suijin: 0x…`, then `wrote packages/sdk/src/deployment.json` with no `0x0` left in it.

- [ ] **Step 2: Run the proof on testnet with the team keys**

```bash
bun run e2e
```
Expected: `E2E OK`. Copy the printed digests (issue allowance, create fixed, create curve, create order, fill, revoke) into the README's "Proof" section (Task 21).

The script ends by revoking its allowance. The maker account therefore starts the UI demo clean, and Task 19 grants a fresh allowance.

- [ ] **Step 3: Commit the deployment**

```bash
git add packages/sdk/src/deployment.json && git commit -m "chore: testnet deployment"
```

---

## Phase 3: Server (Lane C)

### Task 14: Fill pre-flight

**Files:**
- Test: `apps/server/tests/plan.test.ts`
- Create: `apps/server/src/plan.ts`

- [ ] **Step 1: Write the failing tests `apps/server/tests/plan.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import type { AllowanceState, OrderState, StrategyState } from '@suijin/sdk';
import { planFill } from '../src/plan';

const NOW = 1_000;

const order: OrderState = {
  id: '0x0rd',
  taker: '0xb',
  recipient: '0xb',
  strategyId: '0xf',
  quoteIn: 10_000_000n,
  minBaseOut: 1_485_000_000n,
  quotedBaseOut: 1_500_000_000n,
  expiryMs: 60_000n,
  status: 'open',
};

const strategy: StrategyState = {
  id: '0xf',
  maker: '0xa',
  makerAllowanceId: '0xa11',
  kind: 'fixed',
  active: true,
  expiryMs: 9_000_000n,
  maxBasePerFill: 10n ** 12n,
  virtualBaseRemaining: 10n ** 12n,
  priceNum: 1n,
  priceDen: 150n,
  virtualBase: 0n,
  virtualQuote: 0n,
  feeBps: 0n,
  fillCount: 0n,
  baseFilled: 0n,
  quoteReceived: 0n,
};

const payment: AllowanceState = {
  id: '0xpay',
  funder: '0xb',
  spender: '0xe',
  app: 'pkg::app::App',
  lifetimeCap: 10_000_000n,
  expirationMs: 60_000n,
  currentSpend: 0n,
};

describe('planFill', () => {
  test('builds exact fill params', () => {
    const r = planFill(order, strategy, payment, '0xpay', NOW);
    expect(r).toEqual({
      ok: true,
      params: {
        strategyId: '0xf',
        orderId: '0x0rd',
        maker: '0xa',
        makerAllowanceId: '0xa11',
        taker: '0xb',
        takerAllowanceId: '0xpay',
        baseOut: 1_500_000_000n,
        quoteIn: 10_000_000n,
      },
    });
  });

  test('refuses replays', () => {
    expect(planFill({ ...order, status: 'filled' }, strategy, payment, '0xpay', NOW)).toEqual({ ok: false, error: 'ORDER_ALREADY_FILLED' });
  });

  test('refuses expired orders', () => {
    expect(planFill(order, strategy, payment, '0xpay', 60_000)).toEqual({ ok: false, error: 'ORDER_EXPIRED' });
  });

  test('refuses paused strategies', () => {
    expect(planFill(order, { ...strategy, active: false }, payment, '0xpay', NOW)).toEqual({ ok: false, error: 'STRATEGY_PAUSED' });
  });

  test('refuses a payment allowance from someone else', () => {
    expect(planFill(order, strategy, { ...payment, funder: '0xc' }, '0xpay', NOW)).toEqual({ ok: false, error: 'WRONG_TAKER_ALLOWANCE' });
  });

  test('refuses when the price moved past min out', () => {
    expect(planFill(order, { ...strategy, priceDen: 140n }, payment, '0xpay', NOW)).toEqual({ ok: false, error: 'SLIPPAGE_EXCEEDED' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd apps/server && bun test
```
Expected: FAIL with `error: Cannot find module '../src/plan'`.

- [ ] **Step 3: Implement `apps/server/src/plan.ts`**

```ts
import { strategyBaseOut, type AllowanceState, type FillParams, type OrderState, type StrategyState } from '@suijin/sdk';

export type PlanResult = { ok: true; params: FillParams } | { ok: false; error: string };

/**
 * Pre-flight for the executor. Move re-checks everything; this only avoids paying gas
 * for fills that would abort, and gives the UI a readable error.
 */
export function planFill(
  order: OrderState | null,
  strategy: StrategyState | null,
  takerAllowance: AllowanceState | null,
  takerAllowanceId: string,
  nowMs: number,
): PlanResult {
  if (!order) return { ok: false, error: 'ORDER_NOT_FOUND' };
  if (order.status === 'filled') return { ok: false, error: 'ORDER_ALREADY_FILLED' };
  if (order.status === 'cancelled') return { ok: false, error: 'ORDER_CANCELLED' };
  if (BigInt(nowMs) >= order.expiryMs) return { ok: false, error: 'ORDER_EXPIRED' };
  if (!strategy || strategy.id !== order.strategyId) return { ok: false, error: 'STRATEGY_NOT_FOUND' };
  if (!strategy.active) return { ok: false, error: 'STRATEGY_PAUSED' };
  if (!takerAllowance) return { ok: false, error: 'ALLOWANCE_REVOKED' };
  if (takerAllowance.funder !== order.taker || takerAllowance.lifetimeCap !== order.quoteIn) {
    return { ok: false, error: 'WRONG_TAKER_ALLOWANCE' };
  }
  const baseOut = strategyBaseOut(strategy, order.quoteIn);
  if (baseOut < order.minBaseOut) return { ok: false, error: 'SLIPPAGE_EXCEEDED' };
  return {
    ok: true,
    params: {
      strategyId: strategy.id,
      orderId: order.id,
      maker: strategy.maker,
      makerAllowanceId: strategy.makerAllowanceId,
      taker: order.taker,
      takerAllowanceId,
      baseOut,
      quoteIn: order.quoteIn,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test
```
Expected: `6 pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
git add apps/server && git commit -m "feat(server): fill pre-flight with readable errors"
```

### Task 15: Executor and HTTP API

**Files:**
- Create: `apps/server/src/executor.ts`
- Create: `apps/server/src/index.ts`

Depends on: Task 13 (a real `deployment.json`). The server refuses to start when the executor key does not match it.

- [ ] **Step 1: Create `apps/server/src/executor.ts`**

```ts
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildFill, getAllowance, getOrder, getStrategy } from '@suijin/sdk';
import { planFill } from './plan';

export type FillOutcome = { ok: true; digest: string } | { ok: false; error: string };

// ponytail: in-memory idempotency, one process. Move's order status is the real replay guard.
const inflight = new Map<string, Promise<FillOutcome>>();

export function fillOrder(client: SuiGrpcClient, signer: Ed25519Keypair, orderId: string, takerAllowanceId: string): Promise<FillOutcome> {
  const running = inflight.get(orderId);
  if (running) return running;
  const job = settle(client, signer, orderId, takerAllowanceId);
  inflight.set(orderId, job);
  job.then((r) => {
    if (!r.ok) inflight.delete(orderId); // failures may be retried
  });
  return job;
}

async function settle(client: SuiGrpcClient, signer: Ed25519Keypair, orderId: string, takerAllowanceId: string): Promise<FillOutcome> {
  const order = await getOrder(orderId);
  const [strategy, payment] = await Promise.all([
    order ? getStrategy(order.strategyId) : null,
    getAllowance(takerAllowanceId),
  ]);
  const plan = planFill(order, strategy, payment, takerAllowanceId, Date.now());
  if (!plan.ok) return plan;
  try {
    const result = await client.signAndExecuteTransaction({
      transaction: buildFill(plan.params),
      signer,
      include: { effects: true },
    });
    if (result.$kind === 'FailedTransaction') {
      return { ok: false, error: result.FailedTransaction.status.error?.message ?? 'FILL_FAILED' };
    }
    await client.waitForTransaction({ result });
    console.log(`filled ${orderId} -> ${result.Transaction.digest}`);
    return { ok: true, digest: result.Transaction.digest };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 2: Create `apps/server/src/index.ts`**

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  DEPLOYMENT,
  GRPC_URL,
  addressBalance,
  buildQuotes,
  getAllowance,
  listStrategies,
  typesOf,
  type AllowanceState,
} from '@suijin/sdk';
import { fillOrder } from './executor';

const secret = process.env.EXECUTOR_SECRET_KEY;
if (!secret) throw new Error('EXECUTOR_SECRET_KEY missing. Get it with: sui keytool export --key-identity executor');
const signer = Ed25519Keypair.fromSecretKey(secret);
if (signer.toSuiAddress() !== DEPLOYMENT.executor) {
  throw new Error(`executor key ${signer.toSuiAddress()} does not match deployment executor ${DEPLOYMENT.executor}`);
}
const client = new SuiGrpcClient({ network: DEPLOYMENT.network, baseUrl: GRPC_URL() });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
const preflight = () => new Response(null, { headers: cors });

async function quotes(quoteIn: bigint) {
  const strategies = await listStrategies();
  const makers = [...new Set(strategies.map((s) => s.maker))];
  const allowanceIds = [...new Set(strategies.map((s) => s.makerAllowanceId))];
  const [balances, allowances] = await Promise.all([
    Promise.all(makers.map(async (m) => [m, await addressBalance(client, m, typesOf().base)] as const)),
    Promise.all(allowanceIds.map(async (id) => [id, await getAllowance(id)] as const)),
  ]);
  const live = allowances.filter((entry): entry is readonly [string, AllowanceState] => entry[1] !== null);
  return buildQuotes({
    strategies,
    makerBalances: new Map(balances),
    allowances: new Map(live),
    quoteIn,
    nowMs: Date.now(),
  });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  routes: {
    '/v1/health': () => json({ ok: true, network: DEPLOYMENT.network, executor: DEPLOYMENT.executor }),
    '/v1/strategies': { GET: async () => json(await listStrategies()), OPTIONS: preflight },
    '/v1/quote': {
      OPTIONS: preflight,
      POST: async (req) => {
        const body = (await req.json()) as { quoteIn?: string };
        if (!body.quoteIn || !/^\d+$/.test(body.quoteIn)) return json({ error: 'quoteIn must be an integer string' }, 400);
        return json(await quotes(BigInt(body.quoteIn)));
      },
    },
    '/v1/orders/:id/fill': {
      OPTIONS: preflight,
      POST: async (req) => {
        const body = (await req.json()) as { takerAllowanceId?: string };
        if (!body.takerAllowanceId) return json({ error: 'takerAllowanceId required' }, 400);
        const outcome = await fillOrder(client, signer, req.params.id, body.takerAllowanceId);
        return json(outcome, outcome.ok ? 200 : 409);
      },
    },
  },
  fetch: () => json({ error: 'NOT_FOUND' }, 404),
});

console.log(`suijin server on ${server.url} (${DEPLOYMENT.network}, executor ${DEPLOYMENT.executor})`);
```

- [ ] **Step 3: Typecheck and start**

```bash
bunx tsc -p tsconfig.json && bun run server
```
Expected: `suijin server on http://localhost:8787/ (testnet, executor 0x…)`

- [ ] **Step 4: Smoke-test from a second terminal**

```bash
curl -s localhost:8787/v1/health
curl -s -X POST localhost:8787/v1/quote -H 'content-type: application/json' -d '{"quoteIn":"10000000"}'
```
Expected:
- The first call returns `{"ok":true,"network":"testnet","executor":"0x…"}`.
- The second returns `[]` until a maker has an allowance and strategies. After Task 19 it returns two quotes.

- [ ] **Step 5: Commit**

```bash
git add apps/server && git commit -m "feat(server): resolver and executor endpoints"
```

---

## Phase 4: Web (Lane D)

### Task 16: Web scaffold, wallet and chain helpers

**Files:**
- Create: `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/styles.css`
- Create: `apps/web/src/dapp-kit.ts`, `apps/web/src/chain.ts`

- [ ] **Step 1: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Suijin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `apps/web/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react()] });
```

- [ ] **Step 3: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `apps/web/src/styles.css`**

```css
:root {
  --bg: #f4f6f8;
  --card: #fbfcfd;
  --ink: #0f1b2d;
  --muted: #5b6b7c;
  --line: #d5dee7;
  --accent: #2563c9;
  --danger: #b63a34;
  font-family: 'Rubik', system-ui, sans-serif;
  color: var(--ink);
  background: var(--bg);
}
body { margin: 0; background: var(--bg); }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 64px; display: flex; flex-direction: column; gap: 20px; }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
h1 { margin: 0; font-size: 32px; }
h2 { margin: 0 0 12px; font-size: 18px; }
nav { display: flex; gap: 8px; }
nav button.active { background: var(--ink); color: #fff; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.wide { grid-column: 1 / -1; }
.big { font-size: 28px; font-weight: 600; margin: 0; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); font-size: 14px; }
.mono { font-family: ui-monospace, monospace; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
.quote { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; font-variant-numeric: tabular-nums; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--muted); }
input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; width: 140px; }
button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--ink); background: var(--card); color: var(--ink); cursor: pointer; }
button:hover:not(:disabled) { background: var(--ink); color: #fff; }
button:disabled { opacity: 0.5; cursor: default; }
button.danger { border-color: var(--danger); color: var(--danger); }
button.danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.log { margin: 0; padding-left: 18px; font-size: 14px; }
a { color: var(--accent); word-break: break-all; }
footer { font-size: 13px; }
```

- [ ] **Step 5: Create `apps/web/src/dapp-kit.ts`**

dapp-kit v2 is `@mysten/dapp-kit-react`, which re-exports `@mysten/dapp-kit-core`. The legacy `@mysten/dapp-kit` package is not used.

```ts
import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { DEPLOYMENT, GRPC_URL } from '@suijin/sdk';

export const dAppKit = createDAppKit({
  networks: [DEPLOYMENT.network],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URL() }),
});

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
```

- [ ] **Step 6: Create `apps/web/src/chain.ts`**

```ts
import { useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import type { Transaction } from '@mysten/sui/transactions';
import { DEPLOYMENT, type Quote } from '@suijin/sdk';
import { useCallback, useEffect, useState } from 'react';

export const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787';
export const explorerTx = (digest: string) => `https://suiscan.xyz/${DEPLOYMENT.network}/tx/${digest}`;

/** Sign with the wallet, wait for effects, and return helpers to find created objects by type. */
export function useRun() {
  const dAppKit = useDAppKit();
  const client = useCurrentClient();
  return useCallback(
    async (tx: Transaction) => {
      const signed = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (signed.FailedTransaction) throw new Error(signed.FailedTransaction.status.error?.message ?? 'transaction failed');
      const done = await client.waitForTransaction({ digest: signed.Transaction.digest, include: { effects: true, objectTypes: true } });
      if (done.$kind === 'FailedTransaction') throw new Error(done.FailedTransaction.status.error?.message ?? 'transaction failed');
      const { effects, objectTypes } = done.Transaction;
      const created = (fragment: string) =>
        effects.changedObjects.find((c) => c.idOperation === 'Created' && objectTypes[c.objectId]?.includes(fragment))?.objectId ?? '';
      return { digest: done.Transaction.digest, created };
    },
    [dAppKit, client],
  );
}

/** Re-runs `read` every `ms` and whenever `deps` change. `refresh` forces a reload. */
export function usePoll<T>(read: () => Promise<T>, deps: unknown[], ms = 4000) {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => read().then((v) => live && setValue(v)).catch((e) => console.error(e));
    load();
    const id = setInterval(load, ms);
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { value, refresh: () => setTick((t) => t + 1) };
}

const reviveQuote = (q: Record<string, string | number>): Quote => ({
  strategyId: String(q.strategyId),
  kind: q.kind === 'fixed' ? 'fixed' : 'curve',
  maker: String(q.maker),
  makerAllowanceId: String(q.makerAllowanceId),
  quoteIn: BigInt(q.quoteIn!),
  baseOut: BigInt(q.baseOut!),
  minBaseOut: BigInt(q.minBaseOut!),
  expiresAtMs: Number(q.expiresAtMs),
});

export async function fetchQuotes(quoteIn: bigint): Promise<Quote[]> {
  const res = await fetch(`${SERVER}/v1/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteIn: quoteIn.toString() }),
  });
  if (!res.ok) throw new Error(`quote failed: ${res.status}`);
  return ((await res.json()) as Record<string, string | number>[]).map(reviveQuote);
}

export async function requestFill(orderId: string, takerAllowanceId: string): Promise<{ ok: boolean; digest?: string; error?: string }> {
  const res = await fetch(`${SERVER}/v1/orders/${orderId}/fill`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ takerAllowanceId }),
  });
  return res.json();
}
```

- [ ] **Step 7: Typecheck**

```bash
bunx tsc -p apps/web/tsconfig.json
```
Expected: exit code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web && git commit -m "feat(web): scaffold, dapp-kit v2, chain helpers"
```

### Task 17: Maker screen

**Files:** Create `apps/web/src/Maker.tsx`

This screen covers spec §19.1 and §19.2:
- Address balance and minting test coins
- Granting and revoking the allowance, with cap, spent, remaining, spender and expiry shown
- Creating fixed and curve strategies, with pause and resume
- The Shared Liquidity Ratio, labelled "not TVL, not leverage" (INV-012, AC-007)

- [ ] **Step 1: Create `apps/web/src/Maker.tsx`**

```tsx
import { useCurrentAccount, useCurrentClient } from '@mysten/dapp-kit-react';
import {
  addressBalance,
  allowanceRemaining,
  createCurveStrategy,
  createFixedStrategy,
  formatUnits,
  getAllowance,
  issueMakerAllowance,
  listAllowanceCaps,
  listStrategies,
  mintTestCoin,
  parseUnits,
  revokeAllowance,
  setStrategyActive,
  sharedLiquidityRatio,
  typesOf,
} from '@suijin/sdk';
import { useState } from 'react';
import { explorerTx, usePoll, useRun } from './chain';

const HOUR = 3_600_000;
const t = typesOf();

export function Maker() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const run = useRun();
  const me = account?.address ?? '';
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [cap, setCap] = useState('1000000');
  const [price, setPrice] = useState('150');
  const [feeBps, setFeeBps] = useState('30');

  const state = usePoll(async () => {
    if (!me) return null;
    const [jpy, usd, caps, strategies] = await Promise.all([
      addressBalance(client, me, t.base),
      addressBalance(client, me, t.quote),
      listAllowanceCaps(me, t.base),
      listStrategies(),
    ]);
    const current = caps.at(-1) ?? null;
    const allowance = current ? await getAllowance(current.allowanceId) : null;
    const mine = strategies.filter((s) => s.maker === me && s.makerAllowanceId === current?.allowanceId);
    return { jpy, usd, current, allowance, mine };
  }, [me, client]);

  const s = state.value;
  const remaining = s?.allowance ? allowanceRemaining(s.allowance) : null;
  const executable = s ? (remaining !== null && remaining < s.jpy ? remaining : s.jpy) : 0n;

  async function act(label: string, build: () => Parameters<typeof run>[0]) {
    setBusy(label);
    try {
      const r = await run(build());
      setLog((l) => [`${label}: ${r.digest}`, ...l]);
      state.refresh();
      return r;
    } catch (e) {
      setLog((l) => [`${label} failed: ${e instanceof Error ? e.message : e}`, ...l]);
    } finally {
      setBusy('');
    }
  }

  if (!me) return <p className="muted">Connect a wallet to act as the maker.</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const allowanceId = s.current?.allowanceId ?? '';

  return (
    <div className="grid">
      <section className="card">
        <h2>Inventory</h2>
        <p className="big">{formatUnits(s.jpy)} tJPY</p>
        <p className="muted">{formatUnits(s.usd)} tUSD received from trades · address balance, never deposited</p>
        <button disabled={!!busy} onClick={() => act('mint 1,000,000 tJPY', () => mintTestCoin('tjpy', 1_000_000_000_000n))}>
          Mint 1,000,000 test tJPY
        </button>
      </section>

      <section className="card">
        <h2>Allowance</h2>
        {s.allowance ? (
          <>
            <dl>
              <dt>Cap</dt><dd>{formatUnits(s.allowance.lifetimeCap ?? 0n)} tJPY</dd>
              <dt>Spent</dt><dd>{formatUnits(s.allowance.currentSpend)} tJPY</dd>
              <dt>Remaining</dt><dd>{remaining === null ? 'rate-limited' : `${formatUnits(remaining)} tJPY`}</dd>
              <dt>Spender</dt><dd className="mono">{s.allowance.spender?.slice(0, 10)}… (executor)</dd>
              <dt>Expires</dt><dd>{s.allowance.expirationMs ? new Date(Number(s.allowance.expirationMs)).toLocaleString() : '—'}</dd>
            </dl>
            <button
              className="danger"
              disabled={!!busy}
              onClick={() => act('revoke', () => revokeAllowance({ coin: t.base, allowanceId, capId: s.current!.capId }))}
            >
              Revoke allowance
            </button>
          </>
        ) : (
          <>
            <label>
              Cap (tJPY)
              <input value={cap} onChange={(e) => setCap(e.target.value)} />
            </label>
            <button
              disabled={!!busy}
              onClick={() => act('issue allowance', () => issueMakerAllowance({ cap: parseUnits(cap), expiresAtMs: Date.now() + 12 * HOUR }))}
            >
              Grant app-bound allowance (12 h)
            </button>
            <p className="muted">Bounded permission for the executor, enforced by suijin's Move rules. No funds move.</p>
          </>
        )}
      </section>

      <section className="card wide">
        <h2>Strategies on this allowance</h2>
        <p>
          Shared liquidity ratio <b>{sharedLiquidityRatio(s.mine, executable).toFixed(2)}×</b>
          <span className="muted"> · advertised availability over real executable inventory ({formatUnits(executable)} tJPY). Not TVL, not leverage.</span>
        </p>
        <table>
          <thead>
            <tr><th>Kind</th><th>Price</th><th>Advertised</th><th>Fills</th><th>Sold</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {s.mine.map((x) => (
              <tr key={x.id}>
                <td>{x.kind}</td>
                <td>{x.kind === 'fixed' ? `1 tUSD = ${formatUnits(x.priceDen * 1_000_000n / x.priceNum)} tJPY` : `curve, ${x.feeBps} bps`}</td>
                <td>{formatUnits(x.virtualBaseRemaining)}</td>
                <td>{x.fillCount.toString()}</td>
                <td>{formatUnits(x.baseFilled)}</td>
                <td>{x.active ? 'active' : 'paused'}</td>
                <td>
                  <button disabled={!!busy} onClick={() => act(x.active ? 'pause' : 'resume', () => setStrategyActive(x.id, !x.active))}>
                    {x.active ? 'Pause' : 'Resume'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {allowanceId && (
          <div className="row">
            <label>
              1 tUSD =
              <input value={price} onChange={(e) => setPrice(e.target.value)} /> tJPY
            </label>
            <button
              disabled={!!busy}
              onClick={() =>
                act('create fixed', () =>
                  createFixedStrategy({
                    allowanceId,
                    priceNum: 1_000_000n,
                    priceDen: parseUnits(price),
                    maxBasePerFill: s.allowance?.lifetimeCap ?? 0n,
                    virtualBaseLimit: s.allowance?.lifetimeCap ?? 0n,
                    expiresAtMs: Date.now() + 12 * HOUR,
                  }),
                )
              }
            >
              Add fixed-rate strategy
            </button>
            <label>
              Fee
              <input value={feeBps} onChange={(e) => setFeeBps(e.target.value)} /> bps
            </label>
            <button
              disabled={!!busy}
              onClick={() => {
                const inventory = s.allowance?.lifetimeCap ?? 0n;
                return act('create curve', () =>
                  createCurveStrategy({
                    allowanceId,
                    virtualBase: inventory,
                    virtualQuote: (inventory * 1_000_000n) / parseUnits(price),
                    feeBps: BigInt(feeBps),
                    maxBasePerFill: inventory,
                    virtualBaseLimit: inventory,
                    expiresAtMs: Date.now() + 12 * HOUR,
                  }),
                );
              }}
            >
              Add curve strategy
            </button>
          </div>
        )}
      </section>

      <section className="card wide">
        <h2>Activity</h2>
        {busy && <p>{busy}…</p>}
        <ul className="log">
          {log.map((line) => {
            const digest = line.split(': ')[1] ?? '';
            return <li key={line}>{digest.length > 40 ? line : <a href={explorerTx(digest)} target="_blank" rel="noreferrer">{line}</a>}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx tsc -p apps/web/tsconfig.json
```
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web && git commit -m "feat(web): maker dashboard"
```

### Task 18: Trade screen, settlement inspector, app shell

**Files:** Create `apps/web/src/Trade.tsx`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`

This covers spec §19.3 and §19.4. The inspector shows before and after values for the taker, the maker and the allowance spend, plus both transaction links.

- [ ] **Step 1: Create `apps/web/src/Trade.tsx`**

```tsx
import { useCurrentAccount, useCurrentClient } from '@mysten/dapp-kit-react';
import { addressBalance, createTakerOrder, formatUnits, getAllowance, mintTestCoin, parseUnits, typesOf, type Quote } from '@suijin/sdk';
import { useEffect, useState } from 'react';
import { explorerTx, fetchQuotes, requestFill, usePoll, useRun } from './chain';

const t = typesOf();

type Snapshot = { takerUsd: bigint; takerJpy: bigint; makerJpy: bigint; makerUsd: bigint; allowanceSpent: bigint };
type Result = { orderDigest: string; fillDigest?: string; error?: string; before: Snapshot; after?: Snapshot; quote: Quote };

export function Trade() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const run = useRun();
  const me = account?.address ?? '';
  const [amount, setAmount] = useState('10');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const balances = usePoll(async () => {
    if (!me) return null;
    const [usd, jpy] = await Promise.all([addressBalance(client, me, t.quote), addressBalance(client, me, t.base)]);
    return { usd, jpy };
  }, [me, client]);

  async function snapshot(q: Quote): Promise<Snapshot> {
    const [takerUsd, takerJpy, makerJpy, makerUsd, allowance] = await Promise.all([
      addressBalance(client, me, t.quote),
      addressBalance(client, me, t.base),
      addressBalance(client, q.maker, t.base),
      addressBalance(client, q.maker, t.quote),
      getAllowance(q.makerAllowanceId),
    ]);
    return { takerUsd, takerJpy, makerJpy, makerUsd, allowanceSpent: allowance?.currentSpend ?? 0n };
  }

  async function getQuotes() {
    setStatus('Quoting…');
    setResult(null);
    try {
      setQuotes(await fetchQuotes(parseUnits(amount)));
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function swap(q: Quote) {
    try {
      const before = await snapshot(q);
      setStatus('1/2 Sign: exact-cap payment allowance + order (no funds move yet)…');
      const placed = await run(
        createTakerOrder({
          strategyId: q.strategyId,
          quoteIn: q.quoteIn,
          minBaseOut: q.minBaseOut,
          quotedBaseOut: q.baseOut,
          expiresAtMs: Date.now() + 5 * 60_000,
          recipient: me,
        }),
      );
      setStatus('2/2 Executor settles both sides in one PTB…');
      const fill = await requestFill(placed.created('::order::SwapOrder<'), placed.created('::allowance::Allowance<'));
      const after = fill.ok ? await snapshot(q) : undefined;
      setResult({ orderDigest: placed.digest, fillDigest: fill.digest, error: fill.error, before, after, quote: q });
      setStatus(fill.ok ? 'Filled' : `Fill failed: ${fill.error}`);
      balances.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  if (!me) return <p className="muted">Connect a wallet to trade.</p>;

  return (
    <div className="grid">
      <section className="card">
        <h2>Your balance</h2>
        <p className="big">{balances.value ? formatUnits(balances.value.usd) : '…'} tUSD</p>
        <p className="muted">{balances.value ? formatUnits(balances.value.jpy) : '…'} tJPY</p>
        <button onClick={() => run(mintTestCoin('tusd', 100_000_000n)).then(balances.refresh)}>Mint 100 test tUSD</button>
      </section>

      <section className="card">
        <h2>Swap tUSD → tJPY</h2>
        <label>
          You pay (tUSD)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button onClick={getQuotes}>Get quotes</button>
        {quotes.map((q, i) => {
          const secondsLeft = Math.max(0, Math.round((q.expiresAtMs - now) / 1000));
          return (
            <div key={q.strategyId} className="quote">
              <span>
                {i === 0 && <b>Best · </b>}
                {q.kind} strategy → <b>{formatUnits(q.baseOut)} tJPY</b> (min {formatUnits(q.minBaseOut)})
                <br />
                <span className="muted">
                  maker {q.maker.slice(0, 8)}… · {secondsLeft > 0 ? `expires in ${secondsLeft}s` : 'expired, quote again'}
                </span>
              </span>
              <button disabled={secondsLeft === 0} onClick={() => swap(q)}>Swap</button>
            </div>
          );
        })}
        {quotes.length === 0 && status === '' && <p className="muted">No quotes yet.</p>}
        {status && <p>{status}</p>}
      </section>

      {result && (
        <section className="card wide">
          <h2>Settlement inspector</h2>
          <table>
            <thead>
              <tr><th /><th>Before</th><th>After</th></tr>
            </thead>
            <tbody>
              {(
                [
                  ['Taker tUSD', 'takerUsd'],
                  ['Taker tJPY', 'takerJpy'],
                  ['Maker tJPY', 'makerJpy'],
                  ['Maker tUSD', 'makerUsd'],
                  ['Maker allowance spent', 'allowanceSpent'],
                ] as const
              ).map(([label, k]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td>{formatUnits(result.before[k])}</td>
                  <td>{result.after ? formatUnits(result.after[k]) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Order tx: <a href={explorerTx(result.orderDigest)} target="_blank" rel="noreferrer">{result.orderDigest}</a>
            <br />
            Fill tx (one PTB, two allowances):{' '}
            {result.fillDigest ? <a href={explorerTx(result.fillDigest)} target="_blank" rel="noreferrer">{result.fillDigest}</a> : result.error}
          </p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/App.tsx`**

```tsx
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { DEPLOYMENT } from '@suijin/sdk';
import { useState } from 'react';
import { Maker } from './Maker';
import { Trade } from './Trade';

export function App() {
  const [tab, setTab] = useState<'maker' | 'trade'>('maker');
  return (
    <main>
      <header>
        <div>
          <h1>Suijin</h1>
          <p className="muted">One balance, many markets · Sui {DEPLOYMENT.network} · unaudited hackathon build</p>
        </div>
        <ConnectButton />
      </header>
      <nav>
        <button className={tab === 'maker' ? 'active' : ''} onClick={() => setTab('maker')}>Maker</button>
        <button className={tab === 'trade' ? 'active' : ''} onClick={() => setTab('trade')}>Trade</button>
      </nav>
      {tab === 'maker' ? <Maker /> : <Trade />}
      <footer className="muted">
        Virtual availability is not guaranteed simultaneous liquidity. Quotes can fail if maker inventory changes.
      </footer>
    </main>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/main.tsx`**

```tsx
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { dAppKit } from './dapp-kit';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Build**

```bash
cd apps/web && bun run build
```
Expected: `✓ built in …`. A warning that a chunk is larger than 500 kB is expected and harmless.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): trade flow and settlement inspector"
```

### Task 19: UI walkthrough on testnet (all)

Depends on: Tasks 13, 15 and 18.

- [ ] **Step 1: Run both processes**

```bash
bun run server          # terminal 1
bun run web             # terminal 2, open http://localhost:5173
```

- [ ] **Step 2: Maker flow (Slush account = MAKER, network Testnet)**

1. Maker tab: **Mint 1,000,000 test tJPY**. The inventory shows 1,000,000.
2. **Grant app-bound allowance (12 h)** with cap 1000000. The allowance card shows the cap, spent 0 and the executor as spender.
3. **Add fixed-rate strategy** at 150, then **Add curve strategy** at 30 bps.
4. Check: the table has 2 rows, the ratio reads **2.00×**, and the inventory still reads 1,000,000 tJPY.

- [ ] **Step 3: Taker flow (switch the Slush account to TAKER)**

1. Trade tab: **Mint 100 test tUSD**.
2. Pay 10 and click **Get quotes**: two quotes appear, with "Best · fixed … 1,500 tJPY" first.
3. **Swap** on the best quote. Slush asks for one signature; step 2/2 runs without a signature.
4. The inspector shows: taker tUSD −10, taker tJPY +1,500, maker tJPY −1,500, maker tUSD +10, and allowance spent +1,500. The fill link opens on Suiscan.

- [ ] **Step 4: Controls**

1. MAKER pauses the fixed strategy. **Get quotes** now returns only the curve.
2. MAKER clicks **Revoke allowance**. **Get quotes** now returns nothing.
3. Grant a fresh allowance and fresh strategies before the recording.

- [ ] **Step 5: Log bugs in the team channel.** Fix only what breaks the flow above.

---

## Phase 5: Ship (all)

### Task 20: Dress rehearsal and fixes

- [ ] **Step 1:** Run Task 19 end to end twice on a clean maker (new allowance and strategies), with a timer. Target: under 3 minutes.
- [ ] **Step 2:** Save every transaction link from the successful run in `README.md` (Task 21).
- [ ] **Step 3:** Fix only flow-breaking bugs. Re-run `bun run test:ts`, `bun run typecheck` and `cd contracts/suijin && sui move test` after each fix.
- [ ] **Step 4:** Commit: `git commit -am "fix: rehearsal fixes"`

### Task 21: README

**Files:** Create `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Suijin: One Balance, Many Markets

One self-custodial address balance can make the same inventory available to several market
strategies on Sui. Funds move only when a valid trade settles, atomically, in one PTB.

Built for ETHGlobal Tokyo 2026 (Sui DeFi & Payments). **Testnet only. Unaudited.**

## How it works
1. A maker keeps inventory in their **address balance** and grants an **app-bound Allowance**
   (cap, expiry, optional rate limit) to the executor. The Allowance can only be spent through
   suijin's Move rules. No deposit.
2. Several **strategies** (fixed-rate, virtual constant-product curve) reference that one Allowance.
3. A taker signs **one** transaction: an exact-cap payment Allowance plus a `SwapOrder`.
4. The executor submits **one PTB** that pulls both sides through their Allowances. Move recomputes
   the price, checks every amount, recipient and expiry, and swaps. Anything wrong aborts everything.
5. The maker can **revoke** at any time. Every later fill fails.

## Why Sui
Address balances, native Allowances (enabled on testnet since v1.80, not yet on mainnet),
programmable transaction blocks and shared objects. See `docs/superpowers/plans/` for the full design.

## Positioning
DeepBook unifies order flow. STEAMM optimizes deposited liquidity. Suijin multiplexes
self-custodial maker inventory before it is committed to a venue. Inspired by 1inch Aqua
(and Aqua0 on EVM); rebuilt on Sui primitives.

## What we do not claim
No extra real liquidity (the Shared Liquidity Ratio is availability, not TVL or leverage).
Not every advertised position can fill at once. The single executor can delay or censor orders
but cannot change prices, amounts or recipients. Unaudited.

## Deployment (testnet)
See `packages/sdk/src/deployment.json` for the package, config and faucet IDs.

## Proof
Paste the Task 13 and Task 20 transaction links here (issue allowance, two strategies, order,
fill, revoke).

## Run it
    bun install
    cp .env.example .env   # fill the three keys
    bun run deploy          # once, with a funded executor key
    bun run server          # resolver + executor on :8787
    bun run web             # http://localhost:5173

## Tests
    cd contracts/suijin && sui move test   # 26 tests
    bun run test:ts                        # 22 tests
    bun run e2e                            # live proof on testnet
```

- [ ] **Step 2: Fill in the Proof section with the real links, then commit**

```bash
git add README.md && git commit -m "docs: README"
```

### Task 22: Demo video and pitch

- [ ] **Step 1: Record the 3-minute demo** following spec §25, with these UI mappings:

| Time | Show |
|---|---|
| 0:00–0:25 | The problem: inventory split across venues |
| 0:25–0:50 | Maker: 1,000,000 tJPY in the address balance, grant the Allowance. "Permission, not custody." |
| 0:50–1:15 | Two strategies, a ratio of 2.00×, and the balance still at 1,000,000 |
| 1:15–1:45 | Taker: quotes, one signature |
| 1:45–2:20 | Inspector: both balance changes, the Allowance spend, the Suiscan fill PTB with two withdrawals |
| 2:20–2:45 | Revoke, then quotes vanish and a fill fails |
| 2:45–3:00 | The positioning line from the README |

- [ ] **Step 2: Record a backup video** of the same run, in case the live demo fails.
- [ ] **Step 3: Prepare answers to likely judge questions:**
  - What if the executor is malicious? Move recomputes the amounts, and the recipients are fixed.
  - Is the Allowance a guarantee of funds? No, it is a permission.
  - What about mainnet? Allowances are not enabled there yet.
  - How is this different from DeepBook or STEAMM? See the README's positioning section.
  - Where is this going? Show the roadmap deck.

### Task 23: Submit (by 08:00 JST)

- [ ] **Step 1:** Push to a public GitHub repo: `gh repo create suijin --public --source . --push`.
- [ ] **Step 2:** In the ETHGlobal hacker dashboard, fill in the title, description, repo link, demo video and the **Sui DeFi & Payments** prize.
- [ ] **Step 3:** Open the repo link and video in a private window to confirm they are public.

---

## 5. Out of scope for this plan

These stay in the roadmap deck (`One Balance Roadmap`), not in this build:
- Jev pause guard
- Signed RFQ quotes
- Oracle-priced curves
- DeepBook routing
- Solver network
- Operator caps
- Pay with any token
- DCA
- Mainnet

Start one of them only if Task 20 is green before 21:00, and write a small plan for it first.

## 6. Self-review: spec coverage

| Spec | Where |
|---|---|
| P0-1 inventory stays in the address balance | Tasks 3, 13 (`mint` → `send_funds`), 19 |
| P0-2 app-bound Allowance | Task 5 (`issue_maker_allowance`), Task 11 (`issueMakerAllowance`) |
| P0-3 two strategies on one Allowance | Task 6 test `two_strategies_share_one_allowance`, Task 12 e2e |
| P0-4 strategy creation moves no funds | Task 6 (`current_spend == 0`), e2e check "moved zero tJPY" |
| P0-5 resolver quotes both | Task 10 `buildQuotes`, Task 15 `/v1/quote` |
| P0-6 atomic settlement | Task 8 `fill`, e2e fill digest |
| P0-7/8 payment and output land in address balances | Task 8 `send_funds`, e2e balance checks |
| P0-9 no overdraw | Task 8 `executor_cannot_overdraw_maker`, e2e overdraw check, quote caps (Task 10) |
| P0-10 revocation stops fills | e2e "fill after revoke refused", Task 19 |
| PRO-001..013 | `app.move` (permits are package-only, no rotation), `settlement.move` (exact order of checks) |
| INV-001..012 | Covered by the settlement tests plus Move generics (types) and fixed recipients |
| AC-001..007 | Tasks 12, 13, 19 (AC-001 holds because the inventory coin is not the gas coin: D2) |
| OQ-001, OQ-002 | Resolved: verified on devnet; `allowance_settings` accessors exist |
| OQ-003 | Resolved: `mock_coins` (D2) |
| OQ-007 (JEV) | Removed from scope. Jev is a decision model, not a verifier (see roadmap) |

**Known gaps (deliberate, add only if Task 20 is green early):**
- **AC-006 concurrent-fill test is not automated.** Overdraw safety rests on three things: the exact `Balance` value checks (tested), the lifetime cap (tested by the framework), and Sui reserving withdrawals against the funder's balance at scheduling. The spec's concurrency test would need two fills racing past one small cap.
- **RES-007 quote ID:** quotes carry `expiresAtMs` but no UUID. The on-chain `SwapOrder` ID is the durable identifier.
- **§19.4 inspector** shows balances, allowance spend, links and status, but not the strategy's virtual state before and after. That state is visible live in the Maker tab's table.

## 7. Execution handoff

Two options:
1. **Subagent-driven (recommended for agents):** one fresh subagent per task, with a review between tasks.
2. **Inline:** execute the tasks in one session with checkpoints.

Humans can follow the lanes in section 4 directly.
