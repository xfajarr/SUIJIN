import { describe, expect, test } from 'bun:test';
import { eventually } from '../src/eventually';

describe('eventually', () => {
  test('returns as soon as the read finds the object', async () => {
    let calls = 0;
    const value = await eventually(async () => (++calls >= 3 ? 'order' : null), 5, 1);
    expect(value).toBe('order');
    expect(calls).toBe(3);
  });

  test('gives up with null after the last attempt', async () => {
    let calls = 0;
    const value = await eventually(async () => {
      calls++;
      return null;
    }, 4, 1);
    expect(value).toBeNull();
    expect(calls).toBe(4);
  });
});
