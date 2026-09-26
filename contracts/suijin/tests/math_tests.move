#[test_only]
module suijin::math_tests;

use suijin::math;

#[test]
fun fixed_rate_converts_units() {
    // 1 tUSD buys 150 tJPY (both 6 decimals): 10 tUSD -> 1,500 tJPY
    assert!(math::fixed_base_out(10_000_000, 1, 150) == 1_500_000_000, 0);
}

#[test]
fun fixed_rate_rounds_down() {
    // 7 * 1 / 3 = 2.33 -> 2
    assert!(math::fixed_base_out(7, 3, 1) == 2, 0);
}

#[test, expected_failure(abort_code = suijin::math::EZero)]
fun fixed_rate_rejects_zero_price() {
    math::fixed_base_out(10, 0, 1);
}

#[test]
fun curve_rounds_in_favour_of_maker() {
    // k = 1e12, new quote = 1_001_000, exact new base = 999_000.999 -> ceil 999_001 -> out 999
    assert!(math::curve_base_out(1_000, 1_000_000, 1_000_000, 0) == 999, 0);
}

#[test]
fun curve_takes_fee_from_input() {
    // effective in = 9_970, new quote = 1_009_970, new base = ceil(990_128.4) = 990_129 -> out 9_871
    assert!(math::curve_base_out(10_000, 1_000_000, 1_000_000, 30) == 9_871, 0);
}

#[test]
fun curve_handles_max_u64_without_overflow() {
    let max = 18_446_744_073_709_551_615;
    // new base = ceil((2^64 - 1) / 2) = 2^63 -> out = 2^63 - 1
    assert!(math::curve_base_out(max, max, max, 0) == 9_223_372_036_854_775_807, 0);
}

#[test, expected_failure(abort_code = suijin::math::EFeeTooHigh)]
fun curve_rejects_full_fee() {
    math::curve_base_out(1, 1, 1, 10_000);
}
