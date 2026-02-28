import type { Expense, SettlementListItem } from '../services/api';

export type TransactionItem =
  | { type: 'expense'; data: Expense }
  | { type: 'settlement'; data: SettlementListItem };

export function mergeTransactions(
  expenses: Expense[],
  settlements: SettlementListItem[],
): TransactionItem[] {
  const items: TransactionItem[] = [
    ...expenses.map((e) => ({ type: 'expense' as const, data: e })),
    ...settlements.map((s) => ({ type: 'settlement' as const, data: s })),
  ];

  items.sort((a, b) => {
    const diff = new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime();
    if (diff !== 0) return diff;
    // Stable: expenses before settlements at same timestamp
    if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
    return b.data.id - a.data.id;
  });

  return items;
}
