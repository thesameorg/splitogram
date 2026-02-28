import { describe, it, expect } from 'vitest';
import {
  CURRENCIES,
  CURRENCY_CODES,
  CURRENCY_LIST,
  PINNED_CURRENCIES,
  getCurrency,
  searchCurrencies,
} from '../src/utils/currencies';

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
    expect(CURRENCIES.KRW.decimals).toBe(0);
  });

  it('standard currencies have decimals === 2', () => {
    expect(CURRENCIES.USD.decimals).toBe(2);
    expect(CURRENCIES.EUR.decimals).toBe(2);
    expect(CURRENCIES.GBP.decimals).toBe(2);
  });

  it('3-decimal currencies have decimals === 3', () => {
    expect(CURRENCIES.KWD.decimals).toBe(3);
    expect(CURRENCIES.BHD.decimals).toBe(3);
    expect(CURRENCIES.OMR.decimals).toBe(3);
  });

  it('has at least 100 currencies', () => {
    expect(CURRENCY_CODES.length).toBeGreaterThanOrEqual(100);
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

describe('CURRENCY_LIST', () => {
  it('has USD first (pinned)', () => {
    expect(CURRENCY_LIST[0].code).toBe('USD');
  });

  it('has the same number of entries as CURRENCIES', () => {
    expect(CURRENCY_LIST.length).toBe(CURRENCY_CODES.length);
  });

  it('has at least 100 entries', () => {
    expect(CURRENCY_LIST.length).toBeGreaterThanOrEqual(100);
  });

  it('rest (after pinned) is sorted alphabetically by name', () => {
    const rest = CURRENCY_LIST.slice(PINNED_CURRENCIES.length);
    for (let i = 1; i < rest.length; i++) {
      expect(rest[i - 1].name.localeCompare(rest[i].name)).toBeLessThanOrEqual(0);
    }
  });
});

describe('searchCurrencies', () => {
  it('returns all currencies for empty query', () => {
    expect(searchCurrencies('')).toEqual(CURRENCY_LIST);
    expect(searchCurrencies('  ')).toEqual(CURRENCY_LIST);
  });

  it('finds by code', () => {
    const results = searchCurrencies('USD');
    expect(results.some((c) => c.code === 'USD')).toBe(true);
  });

  it('finds by name', () => {
    const results = searchCurrencies('Euro');
    expect(results.some((c) => c.code === 'EUR')).toBe(true);
  });

  it('finds by symbol', () => {
    const results = searchCurrencies('$');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((c) => c.code === 'USD')).toBe(true);
  });

  it('is case-insensitive', () => {
    const upper = searchCurrencies('USD');
    const lower = searchCurrencies('usd');
    expect(upper).toEqual(lower);
  });

  it('returns empty array for no match', () => {
    expect(searchCurrencies('zzzzzzz')).toEqual([]);
  });
});
