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
} from '../../db/schema';
import { computeGroupBalances } from '../balances';
import { CURRENCY_CODES } from '../../utils/currencies';
import { logActivity } from '../../services/activity';
import { generateR2Key, safeR2Delete, validateUpload } from '../../utils/r2';
import type { GroupEnv } from './types';

export const coreApp = new Hono<GroupEnv>();

export function generateInviteCode(): string {
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

coreApp.post('/', zValidator('json', createGroupSchema), async (c) => {
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
coreApp.get('/', async (c) => {
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
coreApp.get('/:id', async (c) => {
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
      muted: groupMembers.muted,
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

coreApp.patch('/:id', zValidator('json', updateGroupSchema), async (c) => {
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
coreApp.post('/:id/mute', async (c) => {
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
coreApp.post('/:id/regenerate-invite', async (c) => {
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
coreApp.post('/:id/avatar', async (c) => {
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
coreApp.delete('/:id/avatar', async (c) => {
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
coreApp.delete('/:id', async (c) => {
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
      // Delete settlement receipts (only for non-onchain settlements — onchain ones are retained)
      const settlementReceipts = await db
        .select({
          receiptKey: settlements.receiptKey,
          receiptThumbKey: settlements.receiptThumbKey,
          status: settlements.status,
        })
        .from(settlements)
        .where(eq(settlements.groupId, groupId));
      for (const r of settlementReceipts) {
        if (r.status === 'settled_onchain') continue; // keep onchain receipts
        if (r.receiptKey) await safeR2Delete(c.env.IMAGES, r.receiptKey);
        if (r.receiptThumbKey) await safeR2Delete(c.env.IMAGES, r.receiptThumbKey);
      }
    })(),
  );

  // Soft-delete: keep group row + on-chain settlements for commission accounting.
  // Delete everything else (expenses, participants, non-onchain settlements, activity, reminders, members).
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
  // Delete only non-onchain settlements; keep onchain ones for commission tracking
  await db
    .delete(settlements)
    .where(and(eq(settlements.groupId, groupId), sql`${settlements.status} != 'settled_onchain'`));
  await db.delete(activityLog).where(eq(activityLog.groupId, groupId));
  await db.delete(debtReminders).where(eq(debtReminders.groupId, groupId));
  await db.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
  // Soft-delete the group (keep the row for on-chain settlement references)
  await db
    .update(groups)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(groups.id, groupId));

  return c.json({ deleted: true, groupId });
});
