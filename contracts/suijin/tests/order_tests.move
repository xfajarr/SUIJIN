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
