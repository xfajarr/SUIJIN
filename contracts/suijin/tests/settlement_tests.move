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
