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
