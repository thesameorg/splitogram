import { describe, it, expect } from 'vitest';
import { mergeTransactions } from '../src/utils/transactions';
import type { Expense, SettlementListItem } from '../src/services/api';

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 1,
    paidBy: 1,
    payerName: 'Alice',
    amount: 1000000,
    description: 'Lunch',
    createdAt: '2025-01-15T12:00:00.000Z',
    participants: [{ userId: 1, displayName: 'Alice', shareAmount: 500000 }],
    ...overrides,
  };
}

function makeSettlement(overrides: Partial<SettlementListItem> = {}): SettlementListItem {
  return {
    id: 1,
    groupId: 1,
    fromUser: 2,
    fromUserName: 'Bob',
    toUser: 1,
    toUserName: 'Alice',
    amount: 500000,
    status: 'settled_external',
    comment: null,
    createdAt: '2025-01-15T13:00:00.000Z',
    ...overrides,
  };
}

describe('mergeTransactions', () => {
  it('returns empty array for empty inputs', () => {
    expect(mergeTransactions([], [])).toEqual([]);
  });

  it('returns expenses-only when no settlements', () => {
    const expenses = [makeExpense({ id: 1 }), makeExpense({ id: 2 })];
    const result = mergeTransactions(expenses, []);
    expect(result.length).toBe(2);
    expect(result.every((t) => t.type === 'expense')).toBe(true);
  });

  it('returns settlements-only when no expenses', () => {
    const settlements = [makeSettlement({ id: 1 }), makeSettlement({ id: 2 })];
    const result = mergeTransactions([], settlements);
    expect(result.length).toBe(2);
    expect(result.every((t) => t.type === 'settlement')).toBe(true);
  });

  it('sorts by createdAt descending (newest first)', () => {
    const expenses = [
      makeExpense({ id: 1, createdAt: '2025-01-10T12:00:00.000Z' }),
      makeExpense({ id: 2, createdAt: '2025-01-20T12:00:00.000Z' }),
    ];
    const settlements = [makeSettlement({ id: 1, createdAt: '2025-01-15T12:00:00.000Z' })];

    const result = mergeTransactions(expenses, settlements);
    expect(result.length).toBe(3);
    expect(result[0].data.id).toBe(2); // Jan 20
    expect(result[0].type).toBe('expense');
    expect(result[1].data.id).toBe(1); // Jan 15
    expect(result[1].type).toBe('settlement');
    expect(result[2].data.id).toBe(1); // Jan 10
    expect(result[2].type).toBe('expense');
  });

  it('expenses come before settlements at same timestamp', () => {
    const ts = '2025-01-15T12:00:00.000Z';
    const expenses = [makeExpense({ id: 10, createdAt: ts })];
    const settlements = [makeSettlement({ id: 20, createdAt: ts })];

    const result = mergeTransactions(expenses, settlements);
    expect(result.length).toBe(2);
    expect(result[0].type).toBe('expense');
    expect(result[1].type).toBe('settlement');
  });

  it('handles mixed interleaving correctly', () => {
    const expenses = [
      makeExpense({ id: 1, createdAt: '2025-01-01T00:00:00.000Z' }),
      makeExpense({ id: 2, createdAt: '2025-01-03T00:00:00.000Z' }),
      makeExpense({ id: 3, createdAt: '2025-01-05T00:00:00.000Z' }),
    ];
    const settlements = [
      makeSettlement({ id: 1, createdAt: '2025-01-02T00:00:00.000Z' }),
      makeSettlement({ id: 2, createdAt: '2025-01-04T00:00:00.000Z' }),
    ];

    const result = mergeTransactions(expenses, settlements);
    expect(result.map((t) => `${t.type[0]}${t.data.id}`)).toEqual([
      'e3', // Jan 5
      's2', // Jan 4
      'e2', // Jan 3
      's1', // Jan 2
      'e1', // Jan 1
    ]);
  });
});
