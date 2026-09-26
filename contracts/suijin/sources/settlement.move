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
