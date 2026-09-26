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
