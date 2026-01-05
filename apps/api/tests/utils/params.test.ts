import { describe, it, expect } from 'vitest';
import { parseIntParam } from '../../src/utils/params.js';

describe('parseIntParam', () => {
  it('returns number for valid integer string', () => {
    expect(parseIntParam('123')).toBe(123);
  });

  it('returns number for zero', () => {
    expect(parseIntParam('0')).toBe(0);
  });

  it('returns null for undefined', () => {
    expect(parseIntParam(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseIntParam('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseIntParam('abc')).toBeNull();
  });

  it('returns null for float string', () => {
    expect(parseIntParam('12.34')).toBeNull();
  });

  it('returns null for negative that parses but is invalid ID', () => {
    // Negative IDs are typically invalid for database records
    expect(parseIntParam('-5')).toBeNull();
  });
});
