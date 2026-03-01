import { describe, it, expect } from 'vitest';
import { calculateShares } from '../src/api/expenses';

describe('calculateShares', () => {
  describe('equal split', () => {
    it('splits evenly among 3 people', () => {
      const result = calculateShares(3_000_000, [1, 2, 3], 'equal');
      expect(result).toEqual([
        { userId: 1, shareAmount: 1_000_000 },
        { userId: 2, shareAmount: 1_000_000 },
        { userId: 3, shareAmount: 1_000_000 },
      ]);
    });

    it('first person absorbs remainder', () => {
      const result = calculateShares(1_000_000, [1, 2, 3], 'equal');
      // 1_000_000 / 3 = 333_333 remainder 1
      expect(result).toEqual([
        { userId: 1, shareAmount: 333_334 },
        { userId: 2, shareAmount: 333_333 },
        { userId: 3, shareAmount: 333_333 },
      ]);
      // Total must equal original amount
      expect(result.reduce((s, r) => s + r.shareAmount, 0)).toBe(1_000_000);
    });

    it('splits between 2 people evenly', () => {
      const result = calculateShares(10_000_000, [1, 2], 'equal');
      expect(result).toEqual([
        { userId: 1, shareAmount: 5_000_000 },
        { userId: 2, shareAmount: 5_000_000 },
      ]);
    });
  });

  describe('percentage split', () => {
    it('converts percentages to amounts', () => {
      const result = calculateShares(10_000_000, [1, 2], 'percentage', [
        { userId: 1, value: 70 },
        { userId: 2, value: 30 },
      ]);
      expect(result).toEqual([
        { userId: 1, shareAmount: 7_000_000 },
        { userId: 2, shareAmount: 3_000_000 },
      ]);
    });

    it('last person absorbs rounding difference', () => {
      // 33.33% of 10_000_000 = 3_333_000 each, but that leaves 1 unaccounted
      const result = calculateShares(10_000_000, [1, 2, 3], 'percentage', [
        { userId: 1, value: 33.33 },
        { userId: 2, value: 33.33 },
        { userId: 3, value: 33.34 },
      ]);
      const total = result.reduce((s, r) => s + r.shareAmount, 0);
      expect(total).toBe(10_000_000);
    });

    it('50/50 split works exactly', () => {
      const result = calculateShares(5_000_000, [1, 2], 'percentage', [
        { userId: 1, value: 50 },
        { userId: 2, value: 50 },
      ]);
      expect(result).toEqual([
        { userId: 1, shareAmount: 2_500_000 },
        { userId: 2, shareAmount: 2_500_000 },
      ]);
    });
  });

  describe('manual split', () => {
    it('passes through values directly', () => {
      const result = calculateShares(10_000_000, [1, 2], 'manual', [
        { userId: 1, value: 7_000_000 },
        { userId: 2, value: 3_000_000 },
      ]);
      expect(result).toEqual([
        { userId: 1, shareAmount: 7_000_000 },
        { userId: 2, shareAmount: 3_000_000 },
      ]);
    });

    it('handles unequal manual amounts', () => {
      const result = calculateShares(1_000_000, [1, 2, 3], 'manual', [
        { userId: 1, value: 500_000 },
        { userId: 2, value: 300_000 },
        { userId: 3, value: 200_000 },
      ]);
      expect(result).toEqual([
        { userId: 1, shareAmount: 500_000 },
        { userId: 2, shareAmount: 300_000 },
        { userId: 3, shareAmount: 200_000 },
      ]);
      expect(result.reduce((s, r) => s + r.shareAmount, 0)).toBe(1_000_000);
    });
  });
});
