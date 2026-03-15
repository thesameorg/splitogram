import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { expenses, expenseParticipants, settlements, groupMembers, users } from '../db/schema';
import { simplifyDebts } from '../services/debt-solver';
import {
  getMembership,
  notMemberResponse,
  parseIntParam,
  invalidIdResponse,
} from '../utils/auth-guards';
import type { Database } from '../db';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type BalanceEnv = AuthContext & DBContext;

const balancesApp = new Hono<BalanceEnv>();

// --- Get optimized debt graph for group ---
balancesApp.get('/', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseIntParam(c, 'id');

  if (!groupId) return invalidIdResponse(c, 'group ID');

  const currentUserId = session.userId;

  if (!(await getMembership(db, groupId, currentUserId))) return notMemberResponse(c);

  // Read cached net balances from group_members
  const memberDetails = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarKey: users.avatarKey,
      netBalance: groupMembers.netBalance,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  const netBalances = new Map(memberDetails.map((m) => [m.userId, m.netBalance]));
  const debts = simplifyDebts(netBalances);

  const memberMap = new Map<number, { displayName: string; username: string | null }>();
  for (const m of memberDetails) {
    memberMap.set(m.userId, { displayName: m.displayName, username: m.username });
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

  const balanceMembers = memberDetails.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    username: m.username,
    avatarKey: m.avatarKey,
    netBalance: m.netBalance,
  }));

  return c.json({ debts: enrichedDebts, members: balanceMembers });
});

// --- Get current user's balance in group ---
balancesApp.get('/me', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseIntParam(c, 'id');

  if (!groupId) return invalidIdResponse(c, 'group ID');

  const currentUserId = session.userId;

  if (!(await getMembership(db, groupId, currentUserId))) return notMemberResponse(c);

  // Read cached net balances from group_members
  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      netBalance: groupMembers.netBalance,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  const netBalances = new Map(members.map((m) => [m.id, m.netBalance]));
  const debts = simplifyDebts(netBalances);

  const memberMap = new Map<number, { displayName: string; username: string | null }>();
  for (const m of members) {
    memberMap.set(m.id, { displayName: m.displayName, username: m.username });
  }

  const iOwe = debts
    .filter((d) => d.from === currentUserId)
    .map((d) => ({
      userId: d.to,
      displayName: memberMap.get(d.to)?.displayName ?? 'Unknown',
      username: memberMap.get(d.to)?.username ?? null,
      amount: d.amount,
    }));

  const owedToMe = debts
    .filter((d) => d.to === currentUserId)
    .map((d) => ({
      userId: d.from,
      displayName: memberMap.get(d.from)?.displayName ?? 'Unknown',
      username: memberMap.get(d.from)?.username ?? null,
      amount: d.amount,
    }));

  const netBalance = netBalances.get(currentUserId) ?? 0;

  return c.json({ netBalance, iOwe, owedToMe });
});

// --- Helper: compute net balances for all members in a group ---
async function computeGroupBalances(db: Database, groupId: number): Promise<Map<number, number>> {
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

// --- Refresh cached net balances on group_members ---
async function refreshGroupBalances(db: Database, groupId: number): Promise<void> {
  // Single atomic SQL UPDATE — computes balances from source of truth and writes in one statement.
  // This prevents race conditions where two concurrent mutations could read stale data
  // and the slower one overwrites the correct cache.
  await db.run(sql`
    UPDATE group_members
    SET net_balance = (
      COALESCE((
        SELECT SUM(amount) FROM expenses
        WHERE group_id = ${groupId} AND paid_by = group_members.user_id
      ), 0)
      - COALESCE((
        SELECT SUM(ep.share_amount) FROM expense_participants ep
        JOIN expenses e ON ep.expense_id = e.id
        WHERE e.group_id = ${groupId} AND ep.user_id = group_members.user_id
      ), 0)
      + COALESCE((
        SELECT SUM(amount) FROM settlements
        WHERE group_id = ${groupId} AND from_user = group_members.user_id
          AND status IN ('settled_onchain', 'settled_external')
      ), 0)
      - COALESCE((
        SELECT SUM(amount) FROM settlements
        WHERE group_id = ${groupId} AND to_user = group_members.user_id
          AND status IN ('settled_onchain', 'settled_external')
      ), 0)
    )
    WHERE group_id = ${groupId}
  `);
}

export { balancesApp, computeGroupBalances, refreshGroupBalances };
