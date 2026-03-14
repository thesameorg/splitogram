import { describe, it, expect } from 'vitest';
import { formatAmount, formatSignedAmount } from '../src/utils/format';

describe('formatAmount', () => {
  it('formats USD amounts with 2 decimals', () => {
    expect(formatAmount(15_000_000)).toBe('$15.00');
    expect(formatAmount(1_500_000)).toBe('$1.50');
    expect(formatAmount(500_000)).toBe('$0.50');
  });

  it('formats zero', () => {
    expect(formatAmount(0)).toBe('$0.00');
  });

  it('formats large amounts', () => {
    expect(formatAmount(999_999_000_000)).toBe('$999 999.00');
  });

  it('formats fractional micro amounts', () => {
    // $12.34 = 12_340_000 micro
    expect(formatAmount(12_340_000)).toBe('$12.34');
  });

  it('uses correct currency symbol for EUR', () => {
    expect(formatAmount(10_000_000, 'EUR')).toBe('\u20AC10.00');
  });

  it('uses correct currency symbol for GBP', () => {
    expect(formatAmount(10_000_000, 'GBP')).toBe('\u00A310.00');
  });

  it('uses correct currency symbol for RUB', () => {
    expect(formatAmount(10_000_000, 'RUB')).toBe('\u20BD10.00');
  });

  it('formats zero-decimal currencies (VND)', () => {
    expect(formatAmount(50_000_000_000, 'VND')).toBe('\u20AB50 000');
  });

  it('formats zero-decimal currencies (JPY)', () => {
    expect(formatAmount(1_000_000_000, 'JPY')).toBe('\u00A51 000');
  });

  it('formats zero-decimal currencies (IDR)', () => {
    expect(formatAmount(100_000_000_000, 'IDR')).toBe('Rp100 000');
  });

  it('falls back to USD for unknown currency', () => {
    expect(formatAmount(5_000_000, 'XYZ')).toBe('$5.00');
  });

  it('defaults to USD when no currency provided', () => {
    expect(formatAmount(5_000_000)).toBe('$5.00');
  });
});

describe('formatSignedAmount', () => {
  it('shows + for positive amounts', () => {
    expect(formatSignedAmount(5_000_000)).toBe('+$5.00');
  });

  it('shows - for negative amounts', () => {
    expect(formatSignedAmount(-5_000_000)).toBe('-$5.00');
  });

  it('shows zero correctly', () => {
    expect(formatSignedAmount(0)).toBe('$0.00');
  });

  it('uses currency for signed positive', () => {
    expect(formatSignedAmount(10_000_000, 'EUR')).toBe('+\u20AC10.00');
  });

  it('uses currency for signed negative', () => {
    expect(formatSignedAmount(-10_000_000, 'EUR')).toBe('-\u20AC10.00');
  });

  it('handles zero-decimal signed amounts', () => {
    expect(formatSignedAmount(50_000_000_000, 'VND')).toBe('+\u20AB50 000');
    expect(formatSignedAmount(-50_000_000_000, 'VND')).toBe('-\u20AB50 000');
  });

  it('shows zero for zero-decimal currencies', () => {
    expect(formatSignedAmount(0, 'JPY')).toBe('\u00A50');
  });
});
