import { eq, and, sql } from 'drizzle-orm';
import {
  users,
  groups,
  groupMembers,
  expenses,
  expenseParticipants,
  settlements,
  activityLog,
  debtReminders,
} from '../db/schema';
import { refreshGroupBalances } from '../api/balances';
import { logActivity } from './activity';
import type { Database } from '../db';

/**
 * When a deleted user rejoins a group via invite link, check if their
 * deletion-created dummy exists in that group and auto-reclaim it.
 *
 * Per-group FK transfer (same pattern as claim-placeholder):
 * - Transfers expenses, participants, settlements, activity_log, groups.createdBy
 * - Removes dummy membership from this group
 * - Deletes dummy user if no other group memberships remain
 *
 * Returns the dummy's display name if reclaimed, null otherwise.
 */
export async function reclaimDeletionDummy(
  db: Database,
  userId: number,
  userTelegramId: number,
  groupId: number,
): Promise<string | null> {
  const dummyTelegramId = -Math.abs(userTelegramId);

  // Find deletion-created dummy
  const [dummy] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.telegramId, dummyTelegramId), eq(users.isDummy, true)))
    .limit(1);

  if (!dummy) return null;

  // Check if dummy is a member of this group
  const [dummyMembership] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, dummy.id)))
    .limit(1);

  if (!dummyMembership) return null;

  const dummyUserId = dummy.id;

  // Per-group FK transfer (same pattern as claim-placeholder in placeholders.ts)
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

  if (expIdsSql) {
    await db.batch([
      // expense_participants: user just joined, no existing rows — safe to transfer
      db
        .update(expenseParticipants)
        .set({ userId })
        .where(and(expIdsSql, eq(expenseParticipants.userId, dummyUserId))),
      // expenses.paid_by
      db
        .update(expenses)
        .set({ paidBy: userId })
        .where(and(eq(expenses.groupId, groupId), eq(expenses.paidBy, dummyUserId))),
      // settlements
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
      // groups.createdBy (if dummy created this group)
      db
        .update(groups)
        .set({ createdBy: userId })
        .where(and(eq(groups.id, groupId), eq(groups.createdBy, dummyUserId))),
      // debt_reminders
      db
        .delete(debtReminders)
        .where(
          and(
            eq(debtReminders.groupId, groupId),
            sql`(${debtReminders.fromUserId} = ${dummyUserId} OR ${debtReminders.toUserId} = ${dummyUserId})`,
          ),
        ),
      // Remove dummy membership from this group
      db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, dummyUserId))),
    ]);
  } else {
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
        .update(groups)
        .set({ createdBy: userId })
        .where(and(eq(groups.id, groupId), eq(groups.createdBy, dummyUserId))),
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

  // Refresh cached balances
  await refreshGroupBalances(db, groupId);

  // Delete dummy user if no other group memberships remain
  const [remaining] = await db
    .select({ count: sql<number>`count(*)` })
    .from(groupMembers)
    .where(eq(groupMembers.userId, dummyUserId));

  if (remaining.count === 0) {
    // Check if dummy still has dangling FK refs in other groups (shouldn't happen, but be safe)
    await db.delete(users).where(eq(users.id, dummyUserId));
  }

  // Log the reclaim event
  await logActivity(db, {
    groupId,
    actorId: userId,
    type: 'placeholder_claimed',
    metadata: { dummyName: dummy.displayName },
  });

  return dummy.displayName;
}
