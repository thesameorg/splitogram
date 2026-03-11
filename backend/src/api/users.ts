import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  users,
  groups,
  groupMembers,
  expenses,
  expenseParticipants,
  settlements,
  activityLog,
  debtReminders,
  imageReports,
} from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { generateR2Key, safeR2Delete, validateUpload } from '../utils/r2';
import { refreshGroupBalances } from './balances';
import { notify } from '../services/notifications';
import { invalidateAuthCache } from '../middleware/auth';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';
import type { Env } from '../env';

type UsersEnv = AuthContext & DBContext & { Bindings: Env };
const app = new Hono<UsersEnv>();

// GET /api/v1/users/me — return current user profile
app.get('/me', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  return c.json({
    id: user.id,
    telegramId: user.telegramId,
    displayName: user.displayName,
    username: user.username,
    avatarKey: user.avatarKey,
  });
});

// PUT /api/v1/users/me — update display name
app.put(
  '/me',
  zValidator(
    'json',
    z.object({
      displayName: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, '')),
    }),
  ),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const { displayName } = c.req.valid('json');

    await db
      .update(users)
      .set({ displayName, updatedAt: new Date().toISOString() })
      .where(eq(users.id, session.userId));

    return c.json({ displayName });
  },
);

// POST /api/v1/users/me/avatar — upload user avatar (multipart)
app.post('/me/avatar', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const body = await c.req.parseBody();
  const file = body['avatar'];
  if (!(file instanceof File)) {
    return c.json({ error: 'missing_file', detail: 'No avatar file provided' }, 400);
  }

  const validationError = validateUpload(file);
  if (validationError) {
    return c.json({ error: 'invalid_file', detail: validationError }, 400);
  }

  const [user] = await db
    .select({ id: users.id, avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Upload new avatar to R2
  const key = generateR2Key('avatars', user.id);
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  // Delete old avatar from R2 (best-effort)
  if (user.avatarKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, user.avatarKey));
  }

  // Save new key in DB
  await db
    .update(users)
    .set({ avatarKey: key, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id));

  return c.json({ avatarKey: key });
});

// DELETE /api/v1/users/me/avatar — remove user avatar
app.delete('/me/avatar', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const [user] = await db
    .select({ id: users.id, avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  if (!user.avatarKey) {
    return c.json({ error: 'no_avatar', detail: 'No avatar to delete' }, 400);
  }

  c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, user.avatarKey));

  await db
    .update(users)
    .set({ avatarKey: null, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id));

  return c.json({ deleted: true });
});

// POST /api/v1/users/feedback — send feedback to admin via bot DM (multipart: message + attachments)
app.post('/feedback', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const body = await c.req.parseBody({ all: true });
  const message = typeof body['message'] === 'string' ? body['message'] : '';
  if (!message || message.length > 2000) {
    return c.json(
      { error: 'invalid_message', detail: 'Message is required (max 2000 chars)' },
      400,
    );
  }

  const adminTelegramId = c.env.ADMIN_TELEGRAM_ID;
  if (!adminTelegramId) {
    return c.json({ sent: true }); // silently succeed if no admin configured
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const text = [
    `📬 Feedback from ${user.displayName}`,
    user.username ? `@${user.username}` : `ID: ${user.telegramId}`,
    '',
    message,
  ].join('\n');

  const chatId = parseInt(adminTelegramId, 10);
  const botToken = c.env.TELEGRAM_BOT_TOKEN;

  // Collect attachment files (attachment_0..4), enforce 10MB per file limit
  // Note: Workers runtime may return Blob (not File) from parseBody — check for Blob
  const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
  const attachments: { blob: Blob; name: string; type: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const raw = body[`attachment_${i}`];
    const file = Array.isArray(raw) ? raw[0] : raw;
    if (file && typeof file !== 'string' && file.size > 0 && file.size <= MAX_ATTACHMENT_SIZE) {
      attachments.push({
        blob: file,
        name: file instanceof File ? file.name : `attachment_${i}`,
        type: file.type || 'application/octet-stream',
      });
    }
  }

  c.executionCtx.waitUntil(
    (async () => {
      try {
        // Send text message first
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(10000),
        });

        // Forward each attachment
        for (const att of attachments) {
          const formData = new FormData();
          formData.append('chat_id', String(chatId));
          const isImage = att.type.startsWith('image/');
          const endpoint = isImage ? 'sendPhoto' : 'sendDocument';
          formData.append(isImage ? 'photo' : 'document', att.blob, att.name);

          await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(30000),
          });
        }
      } catch (e) {
        console.error('Feedback notification failed:', e);
      }
    })(),
  );

  return c.json({ sent: true });
});

// PUT /api/v1/users/me/wallet — set wallet address
const walletSchema = z.object({
  address: z.string().min(1),
});

app.put('/me/wallet', zValidator('json', walletSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { address } = c.req.valid('json');

  await db
    .update(users)
    .set({ walletAddress: address, updatedAt: new Date().toISOString() })
    .where(eq(users.id, session.userId));

  return c.json({ walletAddress: address });
});

// DELETE /api/v1/users/me/wallet — disconnect wallet
app.delete('/me/wallet', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  await db
    .update(users)
    .set({ walletAddress: null, updatedAt: new Date().toISOString() })
    .where(eq(users.id, session.userId));

  return c.json({ walletAddress: null });
});

// DELETE /api/v1/users/me — delete account (reverse-claim: replace user with placeholders in all groups)
app.delete('/me', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Get all groups where the user is a member
  const memberships = await db
    .select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .where(eq(groupMembers.userId, user.id));

  // For each group, create a placeholder and transfer all FK references (reverse-claim)
  for (const membership of memberships) {
    const groupId = membership.groupId;

    // Create a dummy user to replace the real user in this group
    const fakeTelegramId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
    const [dummyUser] = await db
      .insert(users)
      .values({
        telegramId: fakeTelegramId,
        displayName: user.displayName,
        isDummy: true,
      })
      .returning();

    // Add dummy as member with same role
    await db.insert(groupMembers).values({
      groupId,
      userId: dummyUser.id,
      role: membership.role,
    });

    // If user was admin and sole admin, promote another real member (if any)
    if (membership.role === 'admin') {
      const otherRealMembers = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(users.isDummy, false),
            sql`${groupMembers.userId} != ${user.id}`,
          ),
        )
        .limit(1);

      if (otherRealMembers.length > 0) {
        await db
          .update(groupMembers)
          .set({ role: 'admin' })
          .where(
            and(
              eq(groupMembers.groupId, groupId),
              eq(groupMembers.userId, otherRealMembers[0].userId),
            ),
          );
      }
    }

    // Transfer all FK references from real user to dummy in this group
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
        // expense_participants: transfer real user's rows to dummy
        db
          .update(expenseParticipants)
          .set({ userId: dummyUser.id })
          .where(and(expIdsSql, eq(expenseParticipants.userId, user.id))),
        // expenses.paid_by
        db
          .update(expenses)
          .set({ paidBy: dummyUser.id })
          .where(and(eq(expenses.groupId, groupId), eq(expenses.paidBy, user.id))),
        // settlements — from, to, settledBy
        db
          .update(settlements)
          .set({ fromUser: dummyUser.id })
          .where(and(eq(settlements.groupId, groupId), eq(settlements.fromUser, user.id))),
        db
          .update(settlements)
          .set({ toUser: dummyUser.id })
          .where(and(eq(settlements.groupId, groupId), eq(settlements.toUser, user.id))),
        db
          .update(settlements)
          .set({ settledBy: dummyUser.id })
          .where(and(eq(settlements.groupId, groupId), eq(settlements.settledBy, user.id))),
        // activity_log
        db
          .update(activityLog)
          .set({ actorId: dummyUser.id })
          .where(and(eq(activityLog.groupId, groupId), eq(activityLog.actorId, user.id))),
        db
          .update(activityLog)
          .set({ targetUserId: dummyUser.id })
          .where(and(eq(activityLog.groupId, groupId), eq(activityLog.targetUserId, user.id))),
        // debt_reminders — delete (ephemeral)
        db
          .delete(debtReminders)
          .where(
            and(
              eq(debtReminders.groupId, groupId),
              sql`(${debtReminders.fromUserId} = ${user.id} OR ${debtReminders.toUserId} = ${user.id})`,
            ),
          ),
        // Remove real user's membership
        db
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id))),
      ]);
    } else {
      await db.batch([
        db
          .update(settlements)
          .set({ fromUser: dummyUser.id })
          .where(and(eq(settlements.groupId, groupId), eq(settlements.fromUser, user.id))),
        db
          .update(settlements)
          .set({ toUser: dummyUser.id })
          .where(and(eq(settlements.groupId, groupId), eq(settlements.toUser, user.id))),
        db
          .update(settlements)
          .set({ settledBy: dummyUser.id })
          .where(and(eq(settlements.groupId, groupId), eq(settlements.settledBy, user.id))),
        db
          .update(activityLog)
          .set({ actorId: dummyUser.id })
          .where(and(eq(activityLog.groupId, groupId), eq(activityLog.actorId, user.id))),
        db
          .update(activityLog)
          .set({ targetUserId: dummyUser.id })
          .where(and(eq(activityLog.groupId, groupId), eq(activityLog.targetUserId, user.id))),
        db
          .delete(debtReminders)
          .where(
            and(
              eq(debtReminders.groupId, groupId),
              sql`(${debtReminders.fromUserId} = ${user.id} OR ${debtReminders.toUserId} = ${user.id})`,
            ),
          ),
        db
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id))),
      ]);
    }

    // Update groups.createdBy if this user created the group
    await db
      .update(groups)
      .set({ createdBy: dummyUser.id })
      .where(and(eq(groups.id, groupId), eq(groups.createdBy, user.id)));

    // Refresh cached balances
    await refreshGroupBalances(db, groupId);
  }

  // Final sweep: handle any remaining FK references to this user that weren't covered above.
  // This catches orphaned refs from soft-deleted groups (members removed during group deletion,
  // but groups.createdBy and on-chain settlements still reference this user).
  // Create a single ghost dummy for all remaining references.
  const hasOrphanedRefs =
    (
      await db
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.createdBy, user.id))
        .limit(1)
    ).length > 0 ||
    (
      await db
        .select({ id: settlements.id })
        .from(settlements)
        .where(
          sql`(${settlements.fromUser} = ${user.id} OR ${settlements.toUser} = ${user.id} OR ${settlements.settledBy} = ${user.id})`,
        )
        .limit(1)
    ).length > 0 ||
    (
      await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.paidBy, user.id))
        .limit(1)
    ).length > 0 ||
    (
      await db
        .select({ id: expenseParticipants.id })
        .from(expenseParticipants)
        .where(eq(expenseParticipants.userId, user.id))
        .limit(1)
    ).length > 0;

  if (hasOrphanedRefs) {
    const ghostTelegramId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
    const [ghostUser] = await db
      .insert(users)
      .values({
        telegramId: ghostTelegramId,
        displayName: user.displayName,
        isDummy: true,
      })
      .returning();

    await db.batch([
      db.update(groups).set({ createdBy: ghostUser.id }).where(eq(groups.createdBy, user.id)),
      db
        .update(settlements)
        .set({ fromUser: ghostUser.id })
        .where(eq(settlements.fromUser, user.id)),
      db
        .update(settlements)
        .set({ toUser: ghostUser.id })
        .where(eq(settlements.toUser, user.id)),
      db
        .update(settlements)
        .set({ settledBy: ghostUser.id })
        .where(eq(settlements.settledBy, user.id)),
      db.update(expenses).set({ paidBy: ghostUser.id }).where(eq(expenses.paidBy, user.id)),
      db
        .update(expenseParticipants)
        .set({ userId: ghostUser.id })
        .where(eq(expenseParticipants.userId, user.id)),
    ]);
  }

  // Clean up activity_log references (actorId is NOT NULL, so delete; targetUserId is nullable)
  await db.delete(activityLog).where(eq(activityLog.actorId, user.id));
  await db
    .update(activityLog)
    .set({ targetUserId: null })
    .where(eq(activityLog.targetUserId, user.id));

  // Clean up debt reminders
  await db
    .delete(debtReminders)
    .where(
      sql`(${debtReminders.fromUserId} = ${user.id} OR ${debtReminders.toUserId} = ${user.id})`,
    );

  // Clean up R2 images (best-effort, fire-and-forget)
  if (user.avatarKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, user.avatarKey));
  }

  // Delete image reports by this user
  await db.delete(imageReports).where(eq(imageReports.reporterTelegramId, user.telegramId));

  // Invalidate KV auth cache
  await invalidateAuthCache(c.env.KV, user.telegramId);

  // Finally, delete the user row
  await db.delete(users).where(eq(users.id, user.id));

  return c.json({ deleted: true });
});

export const usersApp = app;
