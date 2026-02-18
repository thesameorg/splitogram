/**
 * Greedy debt simplification algorithm.
 * Takes net balances per user and returns minimal set of transfers.
 *
 * Net balance = SUM(what I paid for others) - SUM(what others paid for me)
 * Positive = creditor (owed money), Negative = debtor (owes money)
 */

export interface Debt {
  from: number; // user ID (debtor)
  to: number; // user ID (creditor)
  amount: number; // micro-USDT, always positive
}

export function simplifyDebts(balances: Map<number, number>): Debt[] {
  const creditors: Array<{ userId: number; amount: number }> = [];
  const debtors: Array<{ userId: number; amount: number }> = [];

  for (const [userId, balance] of balances) {
    if (balance > 0) {
      creditors.push({ userId, amount: balance });
    } else if (balance < 0) {
      debtors.push({ userId, amount: -balance });
    }
  }

  // Sort descending by amount for greedy matching
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const debts: Debt[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const transfer = Math.min(creditors[ci].amount, debtors[di].amount);

    if (transfer > 0) {
      debts.push({
        from: debtors[di].userId,
        to: creditors[ci].userId,
        amount: transfer,
      });
    }

    creditors[ci].amount -= transfer;
    debtors[di].amount -= transfer;

    if (creditors[ci].amount === 0) ci++;
    if (debtors[di].amount === 0) di++;
  }

  return debts;
}
