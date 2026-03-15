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
import { eq, and, sql, isNull } from 'drizzle-orm';
import { generateR2Key, safeR2Delete, validateUpload } from '../utils/r2';
import { refreshGroupBalances } from './balances';
import { logActivity } from '../services/activity';
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
    walletAddress: user.walletAddress,
    paymentLink: user.paymentLink,
    paymentQrKey: user.paymentQrKey,
  });
});

// PUT /api/v1/users/me — update display name and/or payment link
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
        .transform((s) => s.replace(/[\x00-\x1f\x7f]/g, ''))
        .optional(),
      paymentLink: z.string().trim().max(500).nullable().optional(),
    }),
  ),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const data = c.req.valid('json');

    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (data.displayName !== undefined) set.displayName = data.displayName;
    if (data.paymentLink !== undefined) set.paymentLink = data.paymentLink || null;

    await db.update(users).set(set).where(eq(users.id, session.userId));

    return c.json({ displayName: data.displayName, paymentLink: data.paymentLink });
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
    httpMetadata: { contentType: file.type },
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

// POST /api/v1/users/me/payment-qr — upload payment QR code
app.post('/me/payment-qr', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const body = await c.req.parseBody();
  const file = body['qr'];
  if (!(file instanceof File)) {
    return c.json({ error: 'missing_file', detail: 'No QR file provided' }, 400);
  }

  const validationError = validateUpload(file);
  if (validationError) {
    return c.json({ error: 'invalid_file', detail: validationError }, 400);
  }

  const [user] = await db
    .select({ id: users.id, paymentQrKey: users.paymentQrKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const key = generateR2Key('payment-qr', user.id);
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  if (user.paymentQrKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, user.paymentQrKey));
  }

  await db
    .update(users)
    .set({ paymentQrKey: key, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id));

  return c.json({ paymentQrKey: key });
});

// DELETE /api/v1/users/me/payment-qr — remove payment QR code
app.delete('/me/payment-qr', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const [user] = await db
    .select({ id: users.id, paymentQrKey: users.paymentQrKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  if (!user.paymentQrKey) {
    return c.json({ error: 'no_qr', detail: 'No QR code to delete' }, 400);
  }

  c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, user.paymentQrKey));

  await db
    .update(users)
    .set({ paymentQrKey: null, updatedAt: new Date().toISOString() })
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

  console.log(
    `[feedback] user=${user.displayName} message=${message.length}chars attachments=${attachments.length}`,
    attachments.map((a) => `${a.name}(${a.type}, ${a.blob.size}b)`),
  );

  c.executionCtx.waitUntil(
    (async () => {
      try {
        // Send text message first
        const msgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(10000),
        });
        if (!msgRes.ok) {
          const err = await msgRes.text();
          console.error('[feedback] sendMessage failed:', msgRes.status, err);
        }

        // Forward each attachment
        for (const att of attachments) {
          const fd = new FormData();
          fd.append('chat_id', String(chatId));
          const isImage = att.type.startsWith('image/');
          const endpoint = isImage ? 'sendPhoto' : 'sendDocument';
          fd.append(isImage ? 'photo' : 'document', att.blob, att.name);

          console.log(
            `[feedback] sending ${endpoint}: ${att.name} (${att.type}, ${att.blob.size}b)`,
          );
          const res = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
            method: 'POST',
            body: fd,
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) {
            const err = await res.text();
            console.error(`[feedback] ${endpoint} failed:`, res.status, err);
          }
        }
      } catch (e) {
        console.error('[feedback] notification failed:', e);
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

// GET /api/v1/users/me/deletion-preflight — groups where user is sole admin
app.get('/me/deletion-preflight', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  // Get all non-deleted groups where user is admin
  const adminGroups = await db
    .select({
      groupId: groupMembers.groupId,
      groupName: groups.name,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, session.userId),
        eq(groupMembers.role, 'admin'),
        isNull(groups.deletedAt),
      ),
    );

  const result: Array<{
    id: number;
    name: string;
    candidates: Array<{ userId: number; displayName: string }>;
  }> = [];

  for (const ag of adminGroups) {
    // Check if there are other admins
    const [otherAdmin] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, ag.groupId),
          eq(groupMembers.role, 'admin'),
          sql`${groupMembers.userId} != ${session.userId}`,
        ),
      )
      .limit(1);

    if (otherAdmin) continue; // Not sole admin, skip

    // Find real (non-dummy) members who could become admin
    const candidates = await db
      .select({
        userId: groupMembers.userId,
        displayName: users.displayName,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(
        and(
          eq(groupMembers.groupId, ag.groupId),
          eq(users.isDummy, false),
          sql`${groupMembers.userId} != ${session.userId}`,
        ),
      );

    result.push({
      id: ag.groupId,
      name: ag.groupName,
      candidates,
    });
  }

  return c.json({ groups: result });
});

// DELETE /api/v1/users/me — delete account (single dummy with -telegramId for auto-reclaim)
app.delete('/me', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Get all groups where user is a member (including soft-deleted for FK cleanup)
  const memberships = await db
    .select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .where(eq(groupMembers.userId, user.id));

  // Pre-check: verify no sole-admin groups with real members remain unresolved
  for (const m of memberships) {
    if (m.role !== 'admin') continue;

    // Check if another admin exists in this group
    const [otherAdmin] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, m.groupId),
          eq(groupMembers.role, 'admin'),
          sql`${groupMembers.userId} != ${user.id}`,
        ),
      )
      .limit(1);

    if (otherAdmin) continue; // Another admin exists, fine

    // Sole admin — check if there are real (non-dummy) members
    const [realMember] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(
        and(
          eq(groupMembers.groupId, m.groupId),
          eq(users.isDummy, false),
          sql`${groupMembers.userId} != ${user.id}`,
        ),
      )
      .limit(1);

    if (realMember) {
      return c.json(
        {
          error: 'unresolved_admin_groups',
          detail: 'Transfer admin role or delete groups first',
        },
        400,
      );
    }

    // Sole admin with only dummies — soft-delete the group
    // (replicates group delete logic from core.ts)
    const groupExpenses = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.groupId, m.groupId));

    if (groupExpenses.length > 0) {
      const expenseIds = groupExpenses.map((e) => e.id);
      await db.delete(expenseParticipants).where(
        sql`${expenseParticipants.expenseId} IN (${sql.join(
          expenseIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }

    await db.delete(expenses).where(eq(expenses.groupId, m.groupId));
    await db
      .delete(settlements)
      .where(
        and(eq(settlements.groupId, m.groupId), sql`${settlements.status} != 'settled_onchain'`),
      );
    await db.delete(activityLog).where(eq(activityLog.groupId, m.groupId));
    await db.delete(debtReminders).where(eq(debtReminders.groupId, m.groupId));
    await db.delete(groupMembers).where(eq(groupMembers.groupId, m.groupId));
    await db
      .update(groups)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(groups.id, m.groupId));
  }

  // Re-fetch memberships (some groups may have been soft-deleted above)
  const remainingMemberships = await db
    .select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .where(eq(groupMembers.userId, user.id));

  // Check if any FK references exist (groups.createdBy, settlements, activity_log, etc.)
  // Even with no remaining memberships, on-chain settlements and soft-deleted groups
  // may still reference the user — we need a dummy to absorb those references.
  const [fkCheck] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(groups)
    .where(eq(groups.createdBy, user.id));
  const [settlementCheck] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(settlements)
    .where(sql`${settlements.fromUser} = ${user.id} OR ${settlements.toUser} = ${user.id}`);
  const [activityCheck] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(activityLog)
    .where(sql`${activityLog.actorId} = ${user.id} OR ${activityLog.targetUserId} = ${user.id}`);

  const hasDanglingRefs =
    remainingMemberships.length > 0 ||
    (fkCheck?.cnt ?? 0) > 0 ||
    (settlementCheck?.cnt ?? 0) > 0 ||
    (activityCheck?.cnt ?? 0) > 0;

  if (hasDanglingRefs) {
    // Create ONE dummy user with deterministic telegramId for re-claim
    const dummyTelegramId = -Math.abs(user.telegramId);
    const dummyDisplayName = `(${user.displayName})`;

    // Reuse existing dummy if one already exists (e.g., previous deletion cycle)
    const [existingDummy] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, dummyTelegramId));

    let dummyUser: typeof existingDummy;
    if (existingDummy) {
      await db
        .update(users)
        .set({ displayName: dummyDisplayName })
        .where(eq(users.id, existingDummy.id));
      dummyUser = { ...existingDummy, displayName: dummyDisplayName };
    } else {
      [dummyUser] = await db
        .insert(users)
        .values({
          telegramId: dummyTelegramId,
          displayName: dummyDisplayName,
          isDummy: true,
        })
        .returning();
    }

    // Add dummy to all remaining groups
    for (const m of remainingMemberships) {
      await db.insert(groupMembers).values({
        groupId: m.groupId,
        userId: dummyUser.id,
        role: m.role,
      });
    }

    // Global FK transfer — one batch for ALL groups (no per-group scoping needed)
    await db.batch([
      db.update(expenses).set({ paidBy: dummyUser.id }).where(eq(expenses.paidBy, user.id)),
      db
        .update(expenseParticipants)
        .set({ userId: dummyUser.id })
        .where(eq(expenseParticipants.userId, user.id)),
      db
        .update(settlements)
        .set({ fromUser: dummyUser.id })
        .where(eq(settlements.fromUser, user.id)),
      db.update(settlements).set({ toUser: dummyUser.id }).where(eq(settlements.toUser, user.id)),
      db
        .update(settlements)
        .set({ settledBy: dummyUser.id })
        .where(eq(settlements.settledBy, user.id)),
      db.update(activityLog).set({ actorId: dummyUser.id }).where(eq(activityLog.actorId, user.id)),
      db
        .update(activityLog)
        .set({ targetUserId: dummyUser.id })
        .where(eq(activityLog.targetUserId, user.id)),
      db.update(groups).set({ createdBy: dummyUser.id }).where(eq(groups.createdBy, user.id)),
      db
        .delete(debtReminders)
        .where(
          sql`(${debtReminders.fromUserId} = ${user.id} OR ${debtReminders.toUserId} = ${user.id})`,
        ),
      db.delete(groupMembers).where(eq(groupMembers.userId, user.id)),
    ]);

    // Log member_deleted activity in each affected group
    for (const m of remainingMemberships) {
      await logActivity(db, {
        groupId: m.groupId,
        actorId: dummyUser.id,
        type: 'member_deleted',
        metadata: {
          originalName: user.displayName,
          dummyName: dummyDisplayName,
        },
      });
    }

    // Refresh cached balances for all affected groups
    for (const m of remainingMemberships) {
      await refreshGroupBalances(db, m.groupId);
    }
  }

  // Delete R2 avatar (dummy doesn't keep it)
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
