import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { expenses, expenseParticipants, settlements, groupMembers, users } from '../db/schema';
import { simplifyDebts } from '../services/debt-solver';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type BalanceEnv = AuthContext & DBContext;

const balancesApp = new Hono<BalanceEnv>();

// --- Get optimized debt graph for group ---
balancesApp.get('/', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id') ?? '', 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Check membership
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  const netBalances = await computeGroupBalances(db, groupId);
  const debts = simplifyDebts(netBalances);

  // Enrich with user display names
  const memberMap = new Map<number, { displayName: string; username: string | null }>();
  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  for (const m of members) {
    memberMap.set(m.id, { displayName: m.displayName, username: m.username });
  }

  const enrichedDebts = debts.map((d) => ({
    from: {
      userId: d.from,
      displayName: memberMap.get(d.from)?.displayName ?? 'Unknown',
      username: memberMap.get(d.from)?.username ?? null,
    },
    to: {
      userId: d.to,
      displayName: memberMap.get(d.to)?.displayName ?? 'Unknown',
      username: memberMap.get(d.to)?.username ?? null,
    },
    amount: d.amount,
  }));

  return c.json({ debts: enrichedDebts });
});

// --- Get current user's balance in group ---
balancesApp.get('/me', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id') ?? '', 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  const netBalances = await computeGroupBalances(db, groupId);
  const debts = simplifyDebts(netBalances);

  // Filter to debts involving current user
  const memberMap = new Map<number, { displayName: string; username: string | null }>();
  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  for (const m of members) {
    memberMap.set(m.id, { displayName: m.displayName, username: m.username });
  }

  const iOwe = debts
    .filter((d) => d.from === currentUser.id)
    .map((d) => ({
      userId: d.to,
      displayName: memberMap.get(d.to)?.displayName ?? 'Unknown',
      username: memberMap.get(d.to)?.username ?? null,
      amount: d.amount,
    }));

  const owedToMe = debts
    .filter((d) => d.to === currentUser.id)
    .map((d) => ({
      userId: d.from,
      displayName: memberMap.get(d.from)?.displayName ?? 'Unknown',
      username: memberMap.get(d.from)?.username ?? null,
      amount: d.amount,
    }));

  const netBalance = netBalances.get(currentUser.id) ?? 0;

  return c.json({ netBalance, iOwe, owedToMe });
});

// --- Helper: compute net balances for all members in a group ---
async function computeGroupBalances(db: any, groupId: number): Promise<Map<number, number>> {
  const balances = new Map<number, number>();

  // Get all group members to ensure everyone is in the map
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  for (const m of members) {
    balances.set(m.userId, 0);
  }

  // What each user paid
  const paidAmounts = await db
    .select({
      userId: expenses.paidBy,
      totalPaid: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(eq(expenses.groupId, groupId))
    .groupBy(expenses.paidBy);

  for (const row of paidAmounts) {
    balances.set(row.userId, (balances.get(row.userId) ?? 0) + row.totalPaid);
  }

  // What each user's share is
  const shareAmounts = await db
    .select({
      userId: expenseParticipants.userId,
      totalShare: sql<number>`coalesce(sum(${expenseParticipants.shareAmount}), 0)`,
    })
    .from(expenseParticipants)
    .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
    .where(eq(expenses.groupId, groupId))
    .groupBy(expenseParticipants.userId);

  for (const row of shareAmounts) {
    balances.set(row.userId, (balances.get(row.userId) ?? 0) - row.totalShare);
  }

  // Completed settlements
  const completedSettlements = await db
    .select({
      fromUser: settlements.fromUser,
      toUser: settlements.toUser,
      amount: settlements.amount,
    })
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        sql`${settlements.status} IN ('settled_onchain', 'settled_external')`,
      ),
    );

  for (const s of completedSettlements) {
    balances.set(s.fromUser, (balances.get(s.fromUser) ?? 0) + s.amount); // debtor paid
    balances.set(s.toUser, (balances.get(s.toUser) ?? 0) - s.amount); // creditor received
  }

  return balances;
}

export { balancesApp, computeGroupBalances };
