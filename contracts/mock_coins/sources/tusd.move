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
