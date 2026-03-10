import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { groups, groupMembers, users, debtReminders } from '../../db/schema';
import { computeGroupBalances, refreshGroupBalances } from '../balances';
import { simplifyDebts } from '../../services/debt-solver';
import { notify } from '../../services/notifications';
import { logActivity } from '../../services/activity';
import { makeNotifyCtx } from '../../utils/notify-ctx';
import { generateInviteCode } from './core';
import type { GroupEnv } from './types';

export const membershipApp = new Hono<GroupEnv>();

// --- Leave group ---
membershipApp.post('/:id/leave', async (c) => {
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
membershipApp.delete('/:id/members/:userId', async (c) => {
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
membershipApp.get('/join/:inviteCode', async (c) => {
  const db = c.get('db');
  const inviteCode = c.req.param('inviteCode');

  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      isPair: groups.isPair,
    })
    .from(groups)
    .where(and(eq(groups.inviteCode, inviteCode), isNull(groups.deletedAt)))
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

membershipApp.post('/:id/join', zValidator('json', joinGroupSchema), async (c) => {
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
    .where(and(eq(groups.id, groupId), eq(groups.inviteCode, inviteCode), isNull(groups.deletedAt)))
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
  const notifyCtx = makeNotifyCtx(c.env, db);
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

membershipApp.post('/:id/reminders', zValidator('json', reminderSchema), async (c) => {
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
  const notifyCtx = makeNotifyCtx(c.env, db);
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
