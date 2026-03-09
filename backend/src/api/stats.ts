import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { expenses, expenseParticipants, settlements, groupMembers, users } from '../db/schema';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type StatsEnv = AuthContext & DBContext;

const statsApp = new Hono<StatsEnv>();

statsApp.get('/', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id') ?? '', 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const currentUserId = session.userId;

  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUserId)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  // Parse period filter
  const period = c.req.query('period') ?? 'all';
  let dateFrom: string | null = null;
  let dateTo: string | null = null;

  if (period !== 'all') {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return c.json({ error: 'invalid_period', detail: 'Period must be "all" or "YYYY-MM"' }, 400);
    }
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
    // Next month
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    dateTo = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  }

  const expenseDateFilter =
    dateFrom && dateTo
      ? sql`AND ${expenses.createdAt} >= ${dateFrom} AND ${expenses.createdAt} < ${dateTo}`
      : sql``;

  const settlementDateFilter =
    dateFrom && dateTo
      ? sql`AND ${settlements.createdAt} >= ${dateFrom} AND ${settlements.createdAt} < ${dateTo}`
      : sql``;

  const [
    totalSpentResult,
    memberSharesResult,
    totalPaidForResult,
    settlementsResult,
    monthsResult,
  ] = await Promise.all([
    // 1. Total spent in group
    db
      .select({
        total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(sql`${expenses.groupId} = ${groupId} ${expenseDateFilter}`),

    // 2. Shares by user (for donut chart + yourShare)
    db
      .select({
        userId: expenseParticipants.userId,
        displayName: users.displayName,
        share: sql<number>`coalesce(sum(${expenseParticipants.shareAmount}), 0)`,
      })
      .from(expenseParticipants)
      .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
      .innerJoin(users, eq(expenseParticipants.userId, users.id))
      .where(sql`${expenses.groupId} = ${groupId} ${expenseDateFilter}`)
      .groupBy(expenseParticipants.userId, users.displayName),

    // 3. Total paid for by current user
    db
      .select({
        total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(
        sql`${expenses.groupId} = ${groupId} AND ${expenses.paidBy} = ${currentUserId} ${expenseDateFilter}`,
      ),

    // 4. Settlements involving current user
    db
      .select({
        fromUser: settlements.fromUser,
        toUser: settlements.toUser,
        amount: settlements.amount,
      })
      .from(settlements)
      .where(
        sql`${settlements.groupId} = ${groupId} AND ${settlements.status} IN ('settled_onchain', 'settled_external') AND (${settlements.fromUser} = ${currentUserId} OR ${settlements.toUser} = ${currentUserId}) ${settlementDateFilter}`,
      ),

    // 5. Available months
    db.all<{ month: string }>(
      sql`SELECT DISTINCT substr(${expenses.createdAt}, 1, 7) as month FROM ${expenses} WHERE ${expenses.groupId} = ${groupId} ORDER BY month DESC`,
    ),
  ]);

  const totalSpent = totalSpentResult[0]?.total ?? 0;
  const totalPaidFor = totalPaidForResult[0]?.total ?? 0;

  const yourShare = memberSharesResult.find((m) => m.userId === currentUserId)?.share ?? 0;

  let paymentsMade = 0;
  let paymentsReceived = 0;
  for (const s of settlementsResult) {
    if (s.fromUser === currentUserId) paymentsMade += s.amount;
    if (s.toUser === currentUserId) paymentsReceived += s.amount;
  }

  const balanceChange = totalPaidFor - yourShare - paymentsMade + paymentsReceived;

  const memberShares = memberSharesResult.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    share: m.share,
  }));

  const availableMonths = monthsResult.map((r) => r.month);

  return c.json({
    totalSpent,
    yourShare,
    totalPaidFor,
    paymentsMade,
    paymentsReceived,
    balanceChange,
    memberShares,
    availableMonths,
  });
});

export { statsApp };
