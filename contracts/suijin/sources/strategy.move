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
