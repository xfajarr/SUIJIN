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
