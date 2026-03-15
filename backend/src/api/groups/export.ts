import { Hono } from 'hono';
import { eq, and, sql, desc } from 'drizzle-orm';
import {
  groups,
  groupMembers,
  users,
  expenses,
  expenseParticipants,
  settlements,
} from '../../db/schema';
import {
  getMembership,
  notMemberResponse,
  parseIntParam,
  invalidIdResponse,
} from '../../utils/auth-guards';
import type { GroupEnv } from './types';

export const exportApp = new Hono<GroupEnv>();

// --- Export group transactions as CSV ---
exportApp.get('/:id/export', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseIntParam(c, 'id');

  if (!groupId) return invalidIdResponse(c, 'group ID');

  const userId = session.userId;

  if (!(await getMembership(db, groupId, userId))) return notMemberResponse(c);

  const [group] = await db
    .select({ name: groups.name, currency: groups.currency })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (!group) {
    return c.json({ error: 'not_found', detail: 'Group not found' }, 404);
  }

  // Fetch all expenses with payer name
  const allExpenses = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      description: expenses.description,
      comment: expenses.comment,
      splitMode: expenses.splitMode,
      createdAt: expenses.createdAt,
      payerName: users.displayName,
    })
    .from(expenses)
    .innerJoin(users, eq(expenses.paidBy, users.id))
    .where(eq(expenses.groupId, groupId))
    .orderBy(desc(expenses.createdAt));

  // Fetch participants for all expenses
  const allParticipants =
    allExpenses.length > 0
      ? await db
          .select({
            expenseId: expenseParticipants.expenseId,
            displayName: users.displayName,
            shareAmount: expenseParticipants.shareAmount,
          })
          .from(expenseParticipants)
          .innerJoin(users, eq(expenseParticipants.userId, users.id))
          .where(
            sql`${expenseParticipants.expenseId} IN (${sql.join(
              allExpenses.map((e) => sql`${e.id}`),
              sql`, `,
            )})`,
          )
      : [];

  // Build participants lookup
  const participantsByExpense = new Map<number, Array<{ name: string; share: number }>>();
  for (const p of allParticipants) {
    const list = participantsByExpense.get(p.expenseId) || [];
    list.push({ name: p.displayName, share: p.shareAmount });
    participantsByExpense.set(p.expenseId, list);
  }

  // Fetch all settlements
  const allSettlements = await db
    .select({
      amount: settlements.amount,
      status: settlements.status,
      comment: settlements.comment,
      createdAt: settlements.createdAt,
      fromName: sql<string>`f.display_name`,
      toName: sql<string>`t.display_name`,
    })
    .from(settlements)
    .innerJoin(sql`users f`, sql`${settlements.fromUser} = f.id`)
    .innerJoin(sql`users t`, sql`${settlements.toUser} = t.id`)
    .where(eq(settlements.groupId, groupId))
    .orderBy(desc(settlements.createdAt));

  // Build CSV
  const escapeCsv = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const toAmount = (micro: number) => (micro / 1_000_000).toFixed(2);

  const rows: string[] = [];
  rows.push('Date,Type,Description,Amount,Currency,Paid By,Participants,Comment');

  for (const exp of allExpenses) {
    const parts = participantsByExpense.get(exp.id) || [];
    const participantStr = parts.map((p) => `${p.name}: ${toAmount(p.share)}`).join('; ');
    rows.push(
      [
        exp.createdAt,
        'expense',
        escapeCsv(exp.description),
        toAmount(exp.amount),
        group.currency,
        escapeCsv(exp.payerName),
        escapeCsv(participantStr),
        escapeCsv(exp.comment || ''),
      ].join(','),
    );
  }

  for (const s of allSettlements) {
    rows.push(
      [
        s.createdAt,
        'settlement',
        escapeCsv(`${s.fromName} → ${s.toName}`),
        toAmount(s.amount),
        group.currency,
        escapeCsv(s.fromName),
        escapeCsv(s.toName),
        escapeCsv(s.comment || ''),
      ].join(','),
    );
  }

  const csv = rows.join('\n');
  const filename = `${group.name.replace(/[^a-zA-Z0-9]/g, '_')}_transactions.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
