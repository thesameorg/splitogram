import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import {
  groups,
  groupMembers,
  users,
  expenses,
  expenseParticipants,
  settlements,
  debtReminders,
  activityLog,
} from '../db/schema';
import { computeGroupBalances, refreshGroupBalances } from './balances';
import { simplifyDebts } from '../services/debt-solver';
import { CURRENCY_CODES } from '../utils/currencies';
import { notify } from '../services/notifications';
import { logActivity } from '../services/activity';
import { generateR2Key, safeR2Delete, validateUpload } from '../utils/r2';
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
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, '')),
  currency: z
    .string()
    .refine((c) => CURRENCY_CODES.includes(c))
    .optional(),
});

groupsApp.post('/', zValidator('json', createGroupSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { name, currency } = c.req.valid('json');

  const userId = session.userId;

  const inviteCode = generateInviteCode();

  const [group] = await db
    .insert(groups)
    .values({
      name,
      inviteCode,
      currency: currency ?? 'USD',
      createdBy: userId,
    })
    .returning();

  // Auto-add creator as admin
  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: userId,
    role: 'admin',
  });

  // Log activity
  await logActivity(db, {
    groupId: group.id,
    actorId: userId,
    type: 'group_created',
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

  const userId = session.userId;

  // Get groups with member count
  const userGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      inviteCode: groups.inviteCode,
      isPair: groups.isPair,
      currency: groups.currency,
      avatarKey: groups.avatarKey,
      avatarEmoji: groups.avatarEmoji,
      createdAt: groups.createdAt,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, userId))
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
    .where(
      sql`${groupMembers.groupId} IN (${sql.join(
        groupIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
    .groupBy(groupMembers.groupId);

  const countMap = new Map(memberCounts.map((r) => [r.groupId, r.count]));

  // Read cached net balances from group_members
  const userBalances = await db
    .select({ groupId: groupMembers.groupId, netBalance: groupMembers.netBalance })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, userId),
        sql`${groupMembers.groupId} IN (${sql.join(
          groupIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
  const balanceMap = new Map(userBalances.map((r) => [r.groupId, r.netBalance]));

  const result = userGroups.map((g) => ({
    id: g.id,
    name: g.name,
    inviteCode: g.inviteCode,
    isPair: g.isPair,
    currency: g.currency,
    avatarKey: g.avatarKey,
    avatarEmoji: g.avatarEmoji,
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

  const userId = session.userId;

  // Check membership
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
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
      avatarKey: users.avatarKey,
      isDummy: users.isDummy,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  // Check if group has any expenses (for currency lock)
  const [expenseCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));

  return c.json({
    id: group.id,
    name: group.name,
    inviteCode: group.inviteCode,
    isPair: group.isPair,
    currency: group.currency,
    avatarKey: group.avatarKey,
    avatarEmoji: group.avatarEmoji,
    createdAt: group.createdAt,
    createdBy: group.createdBy,
    muted: membership.muted,
    hasTransactions: expenseCount.count > 0,
    members,
  });
});

// --- Update group settings ---
const updateGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, ''))
    .optional(),
  currency: z
    .string()
    .refine((c) => CURRENCY_CODES.includes(c))
    .optional(),
  avatarEmoji: z.string().max(10).nullable().optional(),
});

groupsApp.patch('/:id', zValidator('json', updateGroupSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const updates = c.req.valid('json');

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const userId = session.userId;

  // Only admin can update group settings
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can update settings' }, 403);
  }

  // Currency lock: cannot change currency after first expense
  if (updates.currency !== undefined) {
    const [expenseCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(expenses)
      .where(eq(expenses.groupId, groupId));
    if (expenseCount.count > 0) {
      return c.json(
        {
          error: 'currency_locked',
          detail: 'Currency cannot be changed after expenses have been added',
        },
        400,
      );
    }
  }

  const setValues: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.currency !== undefined) setValues.currency = updates.currency;
  if (updates.avatarEmoji !== undefined) setValues.avatarEmoji = updates.avatarEmoji;

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

  const userId = session.userId;

  const [membership] = await db
    .select({ id: groupMembers.id, muted: groupMembers.muted })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  const newMuted = !membership.muted;
  await db.update(groupMembers).set({ muted: newMuted }).where(eq(groupMembers.id, membership.id));

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

  const userId = session.userId;

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
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

// --- Upload group avatar ---
groupsApp.post('/:id/avatar', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const userId = session.userId;

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership || membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can change avatar' }, 403);
  }

  const body = await c.req.parseBody();
  const file = body['avatar'];
  if (!(file instanceof File)) {
    return c.json({ error: 'missing_file', detail: 'No avatar file provided' }, 400);
  }

  const validationError = validateUpload(file);
  if (validationError) {
    return c.json({ error: 'invalid_file', detail: validationError }, 400);
  }

  // Get old avatar key for cleanup
  const [group] = await db
    .select({ avatarKey: groups.avatarKey })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  const key = generateR2Key('groups', groupId);
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  // Delete old avatar (best-effort)
  if (group?.avatarKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, group.avatarKey));
  }

  // Save key and clear emoji (custom image takes priority)
  await db
    .update(groups)
    .set({ avatarKey: key, avatarEmoji: null, updatedAt: new Date().toISOString() })
    .where(eq(groups.id, groupId));

  return c.json({ avatarKey: key });
});

// --- Delete group avatar ---
groupsApp.delete('/:id/avatar', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const userId = session.userId;

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership || membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can change avatar' }, 403);
  }

  const [group] = await db
    .select({ avatarKey: groups.avatarKey })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (group?.avatarKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, group.avatarKey));
  }

  await db
    .update(groups)
    .set({ avatarKey: null, updatedAt: new Date().toISOString() })
    .where(eq(groups.id, groupId));

  return c.json({ deleted: true });
});

// --- Delete group ---
groupsApp.delete('/:id', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const userId = session.userId;

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
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

  // Clean up R2 images (best-effort, fire-and-forget)
  const [groupData] = await db
    .select({ avatarKey: groups.avatarKey })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  c.executionCtx.waitUntil(
    (async () => {
      // Delete group avatar
      if (groupData?.avatarKey) {
        await safeR2Delete(c.env.IMAGES, groupData.avatarKey);
      }
      // Delete all expense receipts for this group
      const receipts = await db
        .select({ receiptKey: expenses.receiptKey, receiptThumbKey: expenses.receiptThumbKey })
        .from(expenses)
        .where(eq(expenses.groupId, groupId));
      for (const r of receipts) {
        if (r.receiptKey) await safeR2Delete(c.env.IMAGES, r.receiptKey);
        if (r.receiptThumbKey) await safeR2Delete(c.env.IMAGES, r.receiptThumbKey);
      }
      // Delete all settlement receipts for this group
      const settlementReceipts = await db
        .select({
          receiptKey: settlements.receiptKey,
          receiptThumbKey: settlements.receiptThumbKey,
        })
        .from(settlements)
        .where(eq(settlements.groupId, groupId));
      for (const r of settlementReceipts) {
        if (r.receiptKey) await safeR2Delete(c.env.IMAGES, r.receiptKey);
        if (r.receiptThumbKey) await safeR2Delete(c.env.IMAGES, r.receiptThumbKey);
      }
    })(),
  );

  // Cascade delete: all referencing tables must be cleaned before deleting the group.
  // activity_log and debt_reminders also have FK references to groups.id — omitting them
  // caused the final `delete groups` to fail with a FK constraint violation, while earlier
  // deletes (expenses, group_members) had already succeeded, leaving the group orphaned
  // but invisible (no group_members → not listed).
  // Get expense IDs for this group
  const groupExpenses = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));

  if (groupExpenses.length > 0) {
    const expenseIds = groupExpenses.map((e) => e.id);
    await db.delete(expenseParticipants).where(
      sql`${expenseParticipants.expenseId} IN (${sql.join(
        expenseIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  await db.delete(expenses).where(eq(expenses.groupId, groupId));
  await db.delete(settlements).where(eq(settlements.groupId, groupId));
  await db.delete(activityLog).where(eq(activityLog.groupId, groupId));
  await db.delete(debtReminders).where(eq(debtReminders.groupId, groupId));
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

  const userId = session.userId;

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (membership.role === 'admin') {
    return c.json(
      {
        error: 'admin_cannot_leave',
        detail: 'Group creator cannot leave. Delete the group instead.',
      },
      400,
    );
  }

  // Check user's net balance is zero
  const netBalances = await computeGroupBalances(db, groupId);
  const userBalance = netBalances.get(userId) ?? 0;
  if (userBalance !== 0) {
    return c.json(
      { error: 'outstanding_balance', detail: 'Settle all debts before leaving the group.' },
      400,
    );
  }

  // Log activity before removing membership
  await logActivity(db, {
    groupId,
    actorId: userId,
    type: 'member_left',
  });

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));

  // Refresh cached balances after member removal
  await refreshGroupBalances(db, groupId);

  return c.json({ left: true, groupId });
});

// --- Kick member (admin only) ---
groupsApp.delete('/:id/members/:userId', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const targetUserId = parseInt(c.req.param('userId'), 10);

  if (isNaN(groupId) || isNaN(targetUserId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid ID' }, 400);
  }

  const userId = session.userId;

  // Check caller is admin
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can kick members' }, 403);
  }

  // Cannot kick self
  if (userId === targetUserId) {
    return c.json({ error: 'cannot_kick_self', detail: 'Cannot kick yourself' }, 400);
  }

  // Check target is a member and not an admin
  const [targetMembership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
    .limit(1);

  if (!targetMembership) {
    return c.json(
      { error: 'target_not_member', detail: 'User is not a member of this group' },
      404,
    );
  }

  if (targetMembership.role === 'admin') {
    return c.json({ error: 'cannot_kick_admin', detail: 'Cannot kick another admin' }, 400);
  }

  // Check target's net balance is zero
  const netBalances = await computeGroupBalances(db, groupId);
  const targetBalance = netBalances.get(targetUserId) ?? 0;
  if (targetBalance !== 0) {
    return c.json({ error: 'outstanding_balance', detail: 'Member has unsettled debts.' }, 400);
  }

  // Log activity
  await logActivity(db, {
    groupId,
    actorId: userId,
    type: 'member_kicked',
    targetUserId,
  });

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

  // Refresh cached balances after member removal
  await refreshGroupBalances(db, groupId);

  return c.json({ kicked: true, groupId, userId: targetUserId });
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

  const userId = session.userId;

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
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (existing) {
    return c.json(
      { error: 'already_member', detail: 'You are already a member of this group' },
      409,
    );
  }

  // Enforce max group size to prevent unbounded growth
  const MAX_GROUP_MEMBERS = 100;
  const [{ count: currentMemberCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  if (currentMemberCount >= MAX_GROUP_MEMBERS) {
    return c.json(
      { error: 'group_full', detail: `Group is full (max ${MAX_GROUP_MEMBERS} members)` },
      400,
    );
  }

  await db.insert(groupMembers).values({
    groupId,
    userId: userId,
    role: 'member',
  });

  // Refresh cached balances (new member starts at 0, but recompute for consistency)
  await refreshGroupBalances(db, groupId);

  // Log activity
  await logActivity(db, {
    groupId,
    actorId: userId,
    type: 'member_joined',
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
          .where(eq(users.id, userId))
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

// --- Send debt reminder ---
const reminderSchema = z.object({
  toUserId: z.number().int().positive(),
});

groupsApp.post('/:id/reminders', zValidator('json', reminderSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const { toUserId } = c.req.valid('json');

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const userId = session.userId;

  // Check membership
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  // Verify user is the creditor in the debt graph
  const netBalances = await computeGroupBalances(db, groupId);
  const debts = simplifyDebts(netBalances);
  const targetDebt = debts.find((d) => d.from === toUserId && d.to === userId);

  if (!targetDebt) {
    return c.json({ error: 'no_debt', detail: 'This user does not owe you' }, 400);
  }

  // Check 24h cooldown
  const [existing] = await db
    .select({ lastSentAt: debtReminders.lastSentAt })
    .from(debtReminders)
    .where(
      and(
        eq(debtReminders.groupId, groupId),
        eq(debtReminders.fromUserId, userId),
        eq(debtReminders.toUserId, toUserId),
      ),
    )
    .limit(1);

  if (existing) {
    const lastSent = new Date(existing.lastSentAt).getTime();
    const cooldownMs = 24 * 60 * 60 * 1000;
    if (Date.now() - lastSent < cooldownMs) {
      return c.json(
        { error: 'cooldown', detail: 'Reminder already sent in the last 24 hours' },
        429,
      );
    }
  }

  // Upsert lastSentAt
  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(debtReminders)
      .set({ lastSentAt: now })
      .where(
        and(
          eq(debtReminders.groupId, groupId),
          eq(debtReminders.fromUserId, userId),
          eq(debtReminders.toUserId, toUserId),
        ),
      );
  } else {
    await db.insert(debtReminders).values({
      groupId,
      fromUserId: userId,
      toUserId,
      lastSentAt: now,
    });
  }

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
        const [[creditor], [debtor], [group]] = await Promise.all([
          db
            .select({ displayName: users.displayName })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1),
          db
            .select({
              telegramId: users.telegramId,
              displayName: users.displayName,
              botStarted: users.botStarted,
            })
            .from(users)
            .where(eq(users.id, toUserId))
            .limit(1),
          db
            .select({ name: groups.name, currency: groups.currency })
            .from(groups)
            .where(eq(groups.id, groupId))
            .limit(1),
        ]);
        await notify.debtReminder(
          notifyCtx,
          creditor,
          debtor,
          { id: groupId, name: group.name },
          targetDebt.amount,
          group.currency,
        );
      } catch (e) {
        console.error('Notification failed (debt_reminder):', e);
      }
    })(),
  );

  return c.json({ sent: true });
});

// --- Create placeholder member (admin only) ---
const createPlaceholderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, '')),
});

groupsApp.post('/:id/placeholders', zValidator('json', createPlaceholderSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const { name } = c.req.valid('json');

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const userId = session.userId;

  // Admin only
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership || membership.role !== 'admin') {
    return c.json(
      { error: 'not_admin', detail: 'Only group admins can add placeholder members' },
      403,
    );
  }

  // Generate unique negative telegramId for dummy
  const fakeTelegramId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

  const [dummyUser] = await db
    .insert(users)
    .values({
      telegramId: fakeTelegramId,
      displayName: name,
      isDummy: true,
    })
    .returning();

  await db.insert(groupMembers).values({
    groupId,
    userId: dummyUser.id,
    role: 'member',
  });

  // Refresh cached balances (new placeholder starts at 0)
  await refreshGroupBalances(db, groupId);

  return c.json(
    {
      userId: dummyUser.id,
      displayName: dummyUser.displayName,
      isDummy: true,
    },
    201,
  );
});

// --- Edit placeholder name (admin only) ---
const editPlaceholderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, '')),
});

groupsApp.put('/:id/placeholders/:userId', zValidator('json', editPlaceholderSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const targetUserId = parseInt(c.req.param('userId'), 10);
  const { name } = c.req.valid('json');

  if (isNaN(groupId) || isNaN(targetUserId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid ID' }, 400);
  }

  const userId = session.userId;

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership || membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can edit placeholders' }, 403);
  }

  // Verify target is a dummy in this group
  const [target] = await db
    .select({ isDummy: users.isDummy })
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(
      and(eq(users.id, targetUserId), eq(users.isDummy, true), eq(groupMembers.groupId, groupId)),
    )
    .limit(1);

  if (!target) {
    return c.json(
      { error: 'not_placeholder', detail: 'User is not a placeholder in this group' },
      404,
    );
  }

  await db
    .update(users)
    .set({ displayName: name, updatedAt: new Date().toISOString() })
    .where(eq(users.id, targetUserId));

  return c.json({ userId: targetUserId, displayName: name });
});

// --- Delete placeholder (admin only, zero balance required) ---
groupsApp.delete('/:id/placeholders/:userId', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const targetUserId = parseInt(c.req.param('userId'), 10);

  if (isNaN(groupId) || isNaN(targetUserId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid ID' }, 400);
  }

  const userId = session.userId;

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!membership || membership.role !== 'admin') {
    return c.json({ error: 'not_admin', detail: 'Only group admins can remove placeholders' }, 403);
  }

  // Verify target is a dummy in this group
  const [target] = await db
    .select({ isDummy: users.isDummy })
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(
      and(eq(users.id, targetUserId), eq(users.isDummy, true), eq(groupMembers.groupId, groupId)),
    )
    .limit(1);

  if (!target) {
    return c.json(
      { error: 'not_placeholder', detail: 'User is not a placeholder in this group' },
      404,
    );
  }

  // Check balance
  const netBalances = await computeGroupBalances(db, groupId);
  const balance = netBalances.get(targetUserId) ?? 0;
  if (balance !== 0) {
    return c.json(
      { error: 'outstanding_balance', detail: 'Placeholder has unsettled debts.' },
      400,
    );
  }

  // Remove membership and dummy user
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));
  await db.delete(users).where(eq(users.id, targetUserId));

  // Refresh cached balances after placeholder removal
  await refreshGroupBalances(db, groupId);

  return c.json({ deleted: true, userId: targetUserId });
});

// --- Claim placeholder (real user takes over a dummy's data) ---
const claimPlaceholderSchema = z.object({
  dummyUserId: z.number().int().positive(),
});

groupsApp.post('/:id/claim-placeholder', zValidator('json', claimPlaceholderSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const { dummyUserId } = c.req.valid('json');

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const userId = session.userId;

  // Verify caller is a member of this group
  const [callerMembership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  if (!callerMembership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  // Verify target is a dummy in this group
  const [dummy] = await db
    .select({ id: users.id, isDummy: users.isDummy, displayName: users.displayName })
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(
      and(eq(users.id, dummyUserId), eq(users.isDummy, true), eq(groupMembers.groupId, groupId)),
    )
    .limit(1);

  if (!dummy) {
    return c.json(
      { error: 'not_placeholder', detail: 'User is not a placeholder in this group' },
      404,
    );
  }

  // Gather data needed before the atomic batch
  const groupExpenseIds = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));
  const expIds = groupExpenseIds.map((e) => e.id);
  const expIdsSql =
    expIds.length > 0
      ? sql`${expenseParticipants.expenseId} IN (${sql.join(
          expIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : null;

  // Transfer all references from dummy to real user atomically via D1 batch.
  // D1 batch wraps all statements in a single transaction — if any fails, all roll back.
  // Note: expenseParticipants ops go BEFORE other mutations since they delete real user's
  // existing rows first (unique constraint), then transfer dummy's rows.
  if (expIdsSql) {
    await db.batch([
      // expense_participants: delete real user's rows first, then transfer dummy's
      db.delete(expenseParticipants).where(and(expIdsSql, eq(expenseParticipants.userId, userId))),
      db
        .update(expenseParticipants)
        .set({ userId: userId })
        .where(and(expIdsSql, eq(expenseParticipants.userId, dummyUserId))),
      // expenses.paid_by
      db
        .update(expenses)
        .set({ paidBy: userId })
        .where(and(eq(expenses.groupId, groupId), eq(expenses.paidBy, dummyUserId))),
      // settlements — from, to, settledBy
      db
        .update(settlements)
        .set({ fromUser: userId })
        .where(and(eq(settlements.groupId, groupId), eq(settlements.fromUser, dummyUserId))),
      db
        .update(settlements)
        .set({ toUser: userId })
        .where(and(eq(settlements.groupId, groupId), eq(settlements.toUser, dummyUserId))),
      db
        .update(settlements)
        .set({ settledBy: userId })
        .where(and(eq(settlements.groupId, groupId), eq(settlements.settledBy, dummyUserId))),
      // activity_log
      db
        .update(activityLog)
        .set({ actorId: userId })
        .where(and(eq(activityLog.groupId, groupId), eq(activityLog.actorId, dummyUserId))),
      db
        .update(activityLog)
        .set({ targetUserId: userId })
        .where(and(eq(activityLog.groupId, groupId), eq(activityLog.targetUserId, dummyUserId))),
      // debt_reminders
      db
        .delete(debtReminders)
        .where(
          and(
            eq(debtReminders.groupId, groupId),
            sql`(${debtReminders.fromUserId} = ${dummyUserId} OR ${debtReminders.toUserId} = ${dummyUserId})`,
          ),
        ),
      // Remove dummy's membership
      db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, dummyUserId))),
    ]);
  } else {
    // No expenses in group — simpler batch without participant ops
    await db.batch([
      db
        .update(settlements)
        .set({ fromUser: userId })
        .where(and(eq(settlements.groupId, groupId), eq(settlements.fromUser, dummyUserId))),
      db
        .update(settlements)
        .set({ toUser: userId })
        .where(and(eq(settlements.groupId, groupId), eq(settlements.toUser, dummyUserId))),
      db
        .update(settlements)
        .set({ settledBy: userId })
        .where(and(eq(settlements.groupId, groupId), eq(settlements.settledBy, dummyUserId))),
      db
        .update(activityLog)
        .set({ actorId: userId })
        .where(and(eq(activityLog.groupId, groupId), eq(activityLog.actorId, dummyUserId))),
      db
        .update(activityLog)
        .set({ targetUserId: userId })
        .where(and(eq(activityLog.groupId, groupId), eq(activityLog.targetUserId, dummyUserId))),
      db
        .delete(debtReminders)
        .where(
          and(
            eq(debtReminders.groupId, groupId),
            sql`(${debtReminders.fromUserId} = ${dummyUserId} OR ${debtReminders.toUserId} = ${dummyUserId})`,
          ),
        ),
      db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, dummyUserId))),
    ]);
  }

  // Refresh cached balances after claim (FK references moved from dummy to real user)
  await refreshGroupBalances(db, groupId);

  // Delete dummy user only if no other group memberships remain (already removed from this group above)
  const [remainingMemberships] = await db
    .select({ count: sql<number>`count(*)` })
    .from(groupMembers)
    .where(eq(groupMembers.userId, dummyUserId));

  if (remainingMemberships.count === 0) {
    await db.delete(users).where(eq(users.id, dummyUserId));
  }

  return c.json({ claimed: true, dummyUserId, dummyName: dummy.displayName });
});

export { groupsApp };
