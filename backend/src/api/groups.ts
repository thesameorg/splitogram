import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { groups, groupMembers, users, expenses, expenseParticipants, settlements } from '../db/schema';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type GroupEnv = AuthContext & DBContext;

const groupsApp = new Hono<GroupEnv>();

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    code += chars[byte % chars.length];
  }
  return code;
}

// --- Create group ---
const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
});

groupsApp.post('/', zValidator('json', createGroupSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { name } = c.req.valid('json');

  // Resolve internal user ID from telegram ID
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const inviteCode = generateInviteCode();

  const [group] = await db
    .insert(groups)
    .values({
      name,
      inviteCode,
      createdBy: user.id,
    })
    .returning();

  // Auto-add creator as admin
  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: user.id,
    role: 'admin',
  });

  return c.json({
    id: group.id,
    name: group.name,
    inviteCode: group.inviteCode,
    isPair: group.isPair,
    createdAt: group.createdAt,
  }, 201);
});

// --- List user's groups ---
groupsApp.get('/', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Get groups with member count
  const userGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      inviteCode: groups.inviteCode,
      isPair: groups.isPair,
      createdAt: groups.createdAt,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, user.id))
    .orderBy(desc(groups.createdAt));

  // For each group, compute net balance for this user
  const result = await Promise.all(
    userGroups.map(async (g) => {
      const netBalance = await computeUserNetBalance(db, g.id, user.id);
      const memberCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, g.id));

      return {
        id: g.id,
        name: g.name,
        inviteCode: g.inviteCode,
        isPair: g.isPair,
        createdAt: g.createdAt,
        role: g.role,
        memberCount: memberCount[0]?.count ?? 0,
        netBalance, // positive = owed to user, negative = user owes
      };
    }),
  );

  return c.json({ groups: result });
});

// --- Get group detail ---
groupsApp.get('/:id', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Check membership
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (!group) {
    return c.json({ error: 'group_not_found', detail: 'Group not found' }, 404);
  }

  // Get members with user info
  const members = await db
    .select({
      userId: users.id,
      telegramId: users.telegramId,
      username: users.username,
      displayName: users.displayName,
      walletAddress: users.walletAddress,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  return c.json({
    id: group.id,
    name: group.name,
    inviteCode: group.inviteCode,
    isPair: group.isPair,
    createdAt: group.createdAt,
    members,
  });
});

// --- Resolve invite code (public — no auth needed for resolving) ---
groupsApp.get('/join/:inviteCode', async (c) => {
  const db = c.get('db');
  const inviteCode = c.req.param('inviteCode');

  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      isPair: groups.isPair,
    })
    .from(groups)
    .where(eq(groups.inviteCode, inviteCode))
    .limit(1);

  if (!group) {
    return c.json({ error: 'invalid_invite', detail: 'This invite link is no longer valid' }, 404);
  }

  const memberCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, group.id));

  return c.json({
    id: group.id,
    name: group.name,
    isPair: group.isPair,
    memberCount: memberCount[0]?.count ?? 0,
  });
});

// --- Join group via invite code ---
const joinGroupSchema = z.object({
  inviteCode: z.string().min(1),
});

groupsApp.post('/:id/join', zValidator('json', joinGroupSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const { inviteCode } = c.req.valid('json');

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Verify group exists and invite code matches
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.inviteCode, inviteCode)))
    .limit(1);

  if (!group) {
    return c.json({ error: 'invalid_invite', detail: 'Invalid invite code for this group' }, 404);
  }

  // Check if already a member
  const [existing] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1);

  if (existing) {
    return c.json({ error: 'already_member', detail: 'You are already a member of this group' }, 409);
  }

  await db.insert(groupMembers).values({
    groupId,
    userId: user.id,
    role: 'member',
  });

  return c.json({ joined: true, groupId, groupName: group.name });
});

// --- Helper: compute net balance for a user in a group ---
async function computeUserNetBalance(db: any, groupId: number, userId: number): Promise<number> {
  // What user paid for others (expenses they paid, minus their own share)
  const paidExpenses = await db
    .select({
      totalPaid: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), eq(expenses.paidBy, userId)));

  // What user's share is across all expenses in this group
  const userShares = await db
    .select({
      totalShare: sql<number>`coalesce(sum(${expenseParticipants.shareAmount}), 0)`,
    })
    .from(expenseParticipants)
    .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
    .where(and(eq(expenses.groupId, groupId), eq(expenseParticipants.userId, userId)));

  // Settlements received (user is creditor, settlement completed)
  const received = await db
    .select({
      totalReceived: sql<number>`coalesce(sum(${settlements.amount}), 0)`,
    })
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        eq(settlements.toUser, userId),
        sql`${settlements.status} IN ('settled_onchain', 'settled_external')`,
      ),
    );

  // Settlements paid (user is debtor, settlement completed)
  const paid = await db
    .select({
      totalPaid: sql<number>`coalesce(sum(${settlements.amount}), 0)`,
    })
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        eq(settlements.fromUser, userId),
        sql`${settlements.status} IN ('settled_onchain', 'settled_external')`,
      ),
    );

  const totalPaid = paidExpenses[0]?.totalPaid ?? 0;
  const totalShare = userShares[0]?.totalShare ?? 0;
  const totalReceived = received[0]?.totalReceived ?? 0;
  const totalSettlementsPaid = paid[0]?.totalPaid ?? 0;

  // Net = what I paid - what I owe + settlements received - settlements I paid
  return totalPaid - totalShare + totalReceived - totalSettlementsPaid;
}

export { groupsApp, computeUserNetBalance };
