import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
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
import { computeGroupBalances, refreshGroupBalances } from '../balances';
import { logActivity } from '../../services/activity';
import {
  getMembership,
  getMembershipRole,
  notMemberResponse,
  parseIntParam,
  invalidIdResponse,
} from '../../utils/auth-guards';
import type { GroupEnv } from './types';

export const placeholdersApp = new Hono<GroupEnv>();

// --- Create placeholder member (admin only) ---
const createPlaceholderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, '')),
});

placeholdersApp.post(
  '/:id/placeholders',
  zValidator('json', createPlaceholderSchema),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const groupId = parseIntParam(c, 'id');
    const { name } = c.req.valid('json');

    if (!groupId) return invalidIdResponse(c, 'group ID');

    const userId = session.userId;

    const membership = await getMembershipRole(db, groupId, userId);
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
  },
);

// --- Edit placeholder name (admin only) ---
const editPlaceholderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, '')),
});

placeholdersApp.put(
  '/:id/placeholders/:userId',
  zValidator('json', editPlaceholderSchema),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const groupId = parseIntParam(c, 'id');
    const targetUserId = parseIntParam(c, 'userId');
    const { name } = c.req.valid('json');

    if (!groupId || !targetUserId) return invalidIdResponse(c);

    const userId = session.userId;

    const membership = await getMembershipRole(db, groupId, userId);
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
  },
);

// --- Delete placeholder (admin only, zero balance required) ---
placeholdersApp.delete('/:id/placeholders/:userId', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseIntParam(c, 'id');
  const targetUserId = parseIntParam(c, 'userId');

  if (!groupId || !targetUserId) return invalidIdResponse(c);

  const userId = session.userId;

  const membership = await getMembershipRole(db, groupId, userId);
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

placeholdersApp.post(
  '/:id/claim-placeholder',
  zValidator('json', claimPlaceholderSchema),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const groupId = parseIntParam(c, 'id');
    const { dummyUserId } = c.req.valid('json');

    if (!groupId) return invalidIdResponse(c, 'group ID');

    const userId = session.userId;

    const callerMembership = await getMembership(db, groupId, userId);
    if (!callerMembership) return notMemberResponse(c);

    if (callerMembership.role === 'admin') {
      return c.json(
        { error: 'admin_cannot_claim', detail: 'Group admin cannot claim a placeholder' },
        400,
      );
    }

    // Verify target is a dummy in this group
    const [dummy] = await db
      .select({
        id: users.id,
        isDummy: users.isDummy,
        displayName: users.displayName,
        joinedAt: groupMembers.joinedAt,
      })
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

    // Prevent claiming a placeholder that was created after the user joined
    if (dummy.joinedAt > callerMembership.joinedAt) {
      return c.json(
        {
          error: 'placeholder_created_after_join',
          detail: 'This placeholder was created after you joined the group',
        },
        400,
      );
    }

    // Prevent claiming multiple placeholders — one claim per user per group.
    // Uses activity_log to check for prior placeholder_claimed events.
    const [priorClaim] = await db
      .select({ count: sql<number>`count(*)` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.groupId, groupId),
          eq(activityLog.actorId, userId),
          eq(activityLog.type, 'placeholder_claimed'),
        ),
      );

    if (priorClaim.count > 0) {
      return c.json(
        {
          error: 'already_claimed',
          detail: 'You have already claimed a placeholder in this group',
        },
        400,
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
        db
          .delete(expenseParticipants)
          .where(and(expIdsSql, eq(expenseParticipants.userId, userId))),
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

    // Log the claim event AFTER dummy deletion (avoids FK reference to deleted user)
    await logActivity(db, {
      groupId,
      actorId: userId,
      type: 'placeholder_claimed',
      metadata: { dummyName: dummy.displayName },
    });

    return c.json({ claimed: true, dummyUserId, dummyName: dummy.displayName });
  },
);
