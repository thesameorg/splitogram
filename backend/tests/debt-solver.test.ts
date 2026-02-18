import { describe, it, expect } from 'vitest';
import { simplifyDebts, type Debt } from '../src/services/debt-solver';

describe('simplifyDebts', () => {
  it('returns empty array for zero balances', () => {
    const balances = new Map<number, number>();
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it('returns empty array when all balances are zero', () => {
    const balances = new Map([
      [1, 0],
      [2, 0],
    ]);
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it('handles simple two-person debt', () => {
    // User 1 is owed 100, User 2 owes 100
    const balances = new Map([
      [1, 1_000_000], // +1 USDT
      [2, -1_000_000], // -1 USDT
    ]);
    const debts = simplifyDebts(balances);
    expect(debts).toEqual([{ from: 2, to: 1, amount: 1_000_000 }]);
  });

  it('simplifies three-person cycle into two transfers', () => {
    // A paid 30 for B and C (each owes 10 to A)
    // Net: A = +20, B = -10, C = -10
    const balances = new Map([
      [1, 20_000_000],
      [2, -10_000_000],
      [3, -10_000_000],
    ]);
    const debts = simplifyDebts(balances);
    expect(debts).toHaveLength(2);

    const totalToA = debts.filter((d) => d.to === 1).reduce((sum, d) => sum + d.amount, 0);
    expect(totalToA).toBe(20_000_000);
  });

  it('minimizes transfers in complex group', () => {
    // 4 people: net balances sum to 0
    // A=+30, B=+10, C=-25, D=-15
    const balances = new Map([
      [1, 30_000_000],
      [2, 10_000_000],
      [3, -25_000_000],
      [4, -15_000_000],
    ]);
    const debts = simplifyDebts(balances);

    // Total debts should equal total credits
    const totalSent = debts.reduce((s, d) => s + d.amount, 0);
    expect(totalSent).toBe(40_000_000);

    // Should be at most 3 transfers (n-1 where n=4 participants)
    expect(debts.length).toBeLessThanOrEqual(3);
  });

  it('handles single creditor multiple debtors', () => {
    const balances = new Map([
      [1, 100_000_000],
      [2, -30_000_000],
      [3, -30_000_000],
      [4, -40_000_000],
    ]);
    const debts = simplifyDebts(balances);

    // All transfers should go to user 1
    expect(debts.every((d) => d.to === 1)).toBe(true);
    const total = debts.reduce((s, d) => s + d.amount, 0);
    expect(total).toBe(100_000_000);
  });
});
