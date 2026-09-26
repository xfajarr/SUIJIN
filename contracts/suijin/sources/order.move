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
