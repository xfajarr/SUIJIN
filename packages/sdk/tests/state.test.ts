import { describe, expect, test } from 'bun:test';
import { sameType } from '../src/config';
import { parseStrategy, typeArgs } from '../src/state';

describe('pair types', () => {
  test('typeArgs splits only top-level generics', () => {
    expect(typeArgs('0x1::s::Strategy<0xa::x::X,0xb::y::Y<0xc::z::Z>>')).toEqual(['0xa::x::X', '0xb::y::Y<0xc::z::Z>']);
    expect(typeArgs('0x1::s::Plain')).toEqual([]);
  });

  test('sameType ignores address padding', () => {
    expect(sameType('0x2::sui::SUI', '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI')).toBe(true);
    expect(sameType('0x2::sui::SUI', '0x3::sui::SUI')).toBe(false);
  });

  test('parseStrategy reads the pair from the object type', () => {
    const s = parseStrategy(
      { id: '0xs', maker: '0xa', maker_allowance_id: '0xa11', kind: 1, active: true, expiry_ms: '9', max_base_per_fill: '5', virtual_base_remaining: '5' },
      '0xp::strategy::Strategy<0xc::tusd::TUSD,0xc::tjpy::TJPY>',
    );
    expect(s.kind).toBe('curve');
    expect(s.baseType).toBe('0xc::tusd::TUSD');
    expect(s.quoteType).toBe('0xc::tjpy::TJPY');
  });
});
