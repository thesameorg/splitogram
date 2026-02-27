import { describe, it, expect } from 'vitest';
import { CURRENCIES, CURRENCY_CODES, getCurrency } from '../src/utils/currencies';

describe('CURRENCIES', () => {
  it('contains expected currencies', () => {
    expect(CURRENCIES.USD).toBeDefined();
    expect(CURRENCIES.EUR).toBeDefined();
    expect(CURRENCIES.RUB).toBeDefined();
    expect(CURRENCIES.THB).toBeDefined();
    expect(CURRENCIES.JPY).toBeDefined();
    expect(CURRENCIES.VND).toBeDefined();
  });

  it('has correct structure for each currency', () => {
    for (const code of CURRENCY_CODES) {
      const c = CURRENCIES[code];
      expect(c.code).toBe(code);
      expect(typeof c.symbol).toBe('string');
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(typeof c.name).toBe('string');
      expect(typeof c.decimals).toBe('number');
      expect(c.decimals).toBeGreaterThanOrEqual(0);
    }
  });

  it('zero-decimal currencies have decimals === 0', () => {
    expect(CURRENCIES.VND.decimals).toBe(0);
    expect(CURRENCIES.IDR.decimals).toBe(0);
    expect(CURRENCIES.JPY.decimals).toBe(0);
  });

  it('standard currencies have decimals === 2', () => {
    expect(CURRENCIES.USD.decimals).toBe(2);
    expect(CURRENCIES.EUR.decimals).toBe(2);
    expect(CURRENCIES.GBP.decimals).toBe(2);
  });
});

describe('CURRENCY_CODES', () => {
  it('matches CURRENCIES keys', () => {
    expect(CURRENCY_CODES).toEqual(Object.keys(CURRENCIES));
  });
});

describe('getCurrency', () => {
  it('returns the correct currency for known codes', () => {
    expect(getCurrency('USD')).toBe(CURRENCIES.USD);
    expect(getCurrency('EUR')).toBe(CURRENCIES.EUR);
  });

  it('falls back to USD for unknown codes', () => {
    expect(getCurrency('UNKNOWN')).toBe(CURRENCIES.USD);
    expect(getCurrency('')).toBe(CURRENCIES.USD);
  });
});
