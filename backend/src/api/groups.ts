import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { groups, groupMembers, users, expenses, expenseParticipants, settlements } from '../db/schema';
import { computeGroupBalances } from './balances';
import { CURRENCY_CODES } from '../utils/currencies';
import { notify } from '../services/notifications';
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
  currency: z.string().refine((c) => CURRENCY_CODES.includes(c)).optional(),
});

groupsApp.post('/', zValidator('json', createGroupSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { name, currency } = c.req.valid('json');

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
      currency: currency ?? 'USD',
      createdBy: user.id,
    })
    .returning();

  // Auto-add creator as admin
  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: user.id,
    role: 'admin',
  });

  return c.json(
    {
      id: group.id,
      name: group.name,
      inviteCode: group.inviteCode,
      isPair: group.isPair,
      currency: group.currency,
      createdAt: group.createdAt,
    },
    201,
  );
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
      currency: groups.currency,
      createdAt: groups.createdAt,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, user.id))
    .orderBy(desc(groups.createdAt));

  if (userGroups.length === 0) {
    return c.json({ groups: [] });
  }

  const groupIds = userGroups.map((g) => g.id);

  // Batch: member counts for all groups in one query
  const memberCounts = await db
    .select({
      groupId: groupMembers.groupId,
      count: sql<number>`count(*)`,
    })
    .from(groupMembers)
    .where(sql`${groupMembers.groupId} IN (${sql.join(groupIds.map((id) => sql`${id}`), sql`, `)})`)
    .groupBy(groupMembers.groupId);

  const countMap = new Map(memberCounts.map((r) => [r.groupId, r.count]));

  // Compute net balances per group (uses computeGroupBalances — single source of truth)
  const balanceMap = new Map<number, number>();
  await Promise.all(
    groupIds.map(async (groupId) => {
      const netBalances = await computeGroupBalances(db, groupId);
      balanceMap.set(groupId, netBalances.get(user.id) ?? 0);
    }),
  );

  const result = userGroups.map((g) => ({
    id: g.id,
    name: g.name,
    inviteCode: g.inviteCode,
    isPair: g.isPair,
    currency: g.currency,
    createdAt: g.createdAt,
    role: g.role,
    memberCount: countMap.get(g.id) ?? 0,
    netBalance: balanceMap.get(g.id) ?? 0, // positive = owed to user, negative = user owes
  }));

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

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);

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
    currency: group.currency,
    createdAt: group.createdAt,
    createdBy: group.createdBy,
    muted: membership.muted,
    members,
  });
});

// --- Update group settings ---
const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currency: z.string().refine((c) => CURRENCY_CODES.includes(c)).optional(),
});

groupsApp.patch('/:id', zValidator('json', updateGroupSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const updates = c.req.valid('json');

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

  // Only admin can update group settings
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (membership.role !== 'admin') {
    return c.json(
      { error: 'not_admin', detail: 'Only group admins can update settings' },
      403,
    );
  }

  const setValues: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.currency !== undefined) setValues.currency = updates.currency;

  await db.update(groups).set(setValues).where(eq(groups.id, groupId));

  const [updated] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);

  return c.json({
    id: updated.id,
    name: updated.name,
    currency: updated.currency,
    inviteCode: updated.inviteCode,
  });
});

// --- Toggle mute notifications ---
groupsApp.post('/:id/mute', async (c) => {
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

  const [membership] = await db
    .select({ id: groupMembers.id, muted: groupMembers.muted })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  const newMuted = !membership.muted;
  await db
    .update(groupMembers)
    .set({ muted: newMuted })
    .where(eq(groupMembers.id, membership.id));

  return c.json({ muted: newMuted });
});

// --- Regenerate invite code ---
groupsApp.post('/:id/regenerate-invite', async (c) => {
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

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can regenerate invite' }, 403);
  }

  const newCode = generateInviteCode();
  await db
    .update(groups)
    .set({ inviteCode: newCode, updatedAt: new Date().toISOString() })
    .where(eq(groups.id, groupId));

  return c.json({ inviteCode: newCode });
});

// --- Delete group ---
groupsApp.delete('/:id', async (c) => {
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

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can delete the group' }, 403);
  }

  // Check if there are outstanding balances
  const force = c.req.query('force') === 'true';
  if (!force) {
    const netBalances = await computeGroupBalances(db, groupId);
    const hasOutstanding = Array.from(netBalances.values()).some((b) => b !== 0);
    if (hasOutstanding) {
      return c.json(
        {
          error: 'outstanding_balances',
          detail: 'Group has unsettled balances. Use ?force=true to delete anyway.',
        },
        400,
      );
    }
  }

  // Cascade delete: expense_participants → expenses → settlements → group_members → group
  // Get expense IDs for this group
  const groupExpenses = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));

  if (groupExpenses.length > 0) {
    const expenseIds = groupExpenses.map((e) => e.id);
    await db
      .delete(expenseParticipants)
      .where(sql`${expenseParticipants.expenseId} IN (${sql.join(expenseIds.map((id) => sql`${id}`), sql`, `)})`);
  }

  await db.delete(expenses).where(eq(expenses.groupId, groupId));
  await db.delete(settlements).where(eq(settlements.groupId, groupId));
  await db.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
  await db.delete(groups).where(eq(groups.id, groupId));

  return c.json({ deleted: true, groupId });
});

// --- Leave group ---
groupsApp.post('/:id/leave', async (c) => {
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

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (membership.role === 'admin') {
    return c.json(
      { error: 'admin_cannot_leave', detail: 'Group creator cannot leave. Delete the group instead.' },
      400,
    );
  }

  // Check user's net balance is zero
  const netBalances = await computeGroupBalances(db, groupId);
  const userBalance = netBalances.get(user.id) ?? 0;
  if (userBalance !== 0) {
    return c.json(
      { error: 'outstanding_balance', detail: 'Settle all debts before leaving the group.' },
      400,
    );
  }

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)));

  return c.json({ left: true, groupId });
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
    return c.json(
      { error: 'already_member', detail: 'You are already a member of this group' },
      409,
    );
  }

  await db.insert(groupMembers).values({
    groupId,
    userId: user.id,
    role: 'member',
  });

  // Fire-and-forget notification
  const notifyCtx = {
    botToken: c.env.TELEGRAM_BOT_TOKEN,
    pagesUrl: c.env.PAGES_URL || '',
    onBotBlocked: (telegramId: number) => {
      db.update(users)
        .set({ botStarted: false })
        .where(eq(users.telegramId, telegramId))
        .catch(() => {});
    },
  };
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const [newMember] = await db
          .select({
            telegramId: users.telegramId,
            displayName: users.displayName,
            botStarted: users.botStarted,
          })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);

        const existingMembers = await db
          .select({
            telegramId: users.telegramId,
            displayName: users.displayName,
            botStarted: users.botStarted,
          })
          .from(groupMembers)
          .innerJoin(users, eq(groupMembers.userId, users.id))
          .where(eq(groupMembers.groupId, groupId));

        await notify.memberJoined(notifyCtx, newMember, existingMembers, {
          id: groupId,
          name: group.name,
        });
      } catch (e) {
        console.error('Notification failed (member_joined):', e);
      }
    })(),
  );

  return c.json({ joined: true, groupId, groupName: group.name });
});

export { groupsApp };
