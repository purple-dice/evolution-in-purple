import { headerAsString } from '@utils/headerAsString';
import { describe, expect, it } from 'vitest';

describe('headerAsString', () => {
  it('returns string header values', () => {
    expect(headerAsString('image/png')).toBe('image/png');
  });

  it('returns undefined for missing or non-string header values', () => {
    expect(headerAsString(undefined)).toBeUndefined();
    expect(headerAsString(null)).toBeUndefined();
    expect(headerAsString(42)).toBeUndefined();
    expect(headerAsString(true)).toBeUndefined();
    expect(headerAsString(['a', 'b'])).toBeUndefined();
  });
});
