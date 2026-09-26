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
