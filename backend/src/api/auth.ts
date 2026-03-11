import { Context } from 'hono';
import { TelegramAuthService } from '../services/telegram-auth';
import { createDatabase } from '../db';
import {
  users,
  groupMembers,
  groups,
  expenses,
  expenseParticipants,
  settlements,
  activityLog,
  debtReminders,
} from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { mockUser as devMockUser } from '../dev/mock-user';
import { getDisplayName } from '../models/telegram-user';
import { refreshGroupBalances } from './balances';
import type { Env } from '../env';

const SUPPORTED_LANGS = ['en', 'ru', 'es', 'hi', 'id', 'fa', 'pt', 'uk', 'de', 'it', 'vi'];

function resolveLocale(languageCode: string | undefined): string {
  if (!languageCode) return 'en';
  const lc = languageCode.toLowerCase();
  if (SUPPORTED_LANGS.includes(lc)) return lc;
  const prefix = lc.split('-')[0];
  if (SUPPORTED_LANGS.includes(prefix)) return prefix;
  return 'en';
}

export async function authHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const db = createDatabase(c.env.DB);

  // DEV-ONLY: Auth bypass for local development
  if (c.env.DEV_AUTH_BYPASS_ENABLED === 'true') {
    // Upsert dev user into DB
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, devMockUser.id))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values({
        telegramId: devMockUser.id,
        username: devMockUser.username ?? null,
        displayName: getDisplayName(devMockUser),
      });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, devMockUser.id))
      .limit(1);

    const isAdmin =
      !!c.env.ADMIN_TELEGRAM_ID && String(user.telegramId) === c.env.ADMIN_TELEGRAM_ID;
    return c.json({
      authenticated: true,
      user: {
        id: user.telegramId,
        displayName: user.displayName,
        username: user.username,
      },
      locale: 'en',
      isAdmin,
      source: 'dev_bypass',
    });
  }

  // Extract initData from Authorization header or body
  const authHeader = c.req.header('Authorization');
  let initData: string | null = null;

  if (authHeader) {
    const trimmed = authHeader.trim();
    if (trimmed.startsWith('tma ')) initData = trimmed.substring(4).trim();
    else if (trimmed.startsWith('Bearer ')) initData = trimmed.substring(7).trim();
    else initData = trimmed;
  }

  if (!initData) {
    try {
      const body = await c.req.json<{ initData?: string }>();
      initData = body.initData?.trim() || null;
    } catch {
      // No body
    }
  }

  if (!initData) {
    return c.json({ error: 'auth_required', detail: 'Authentication required' }, 401);
  }

  try {
    const telegramAuth = new TelegramAuthService(c.env.TELEGRAM_BOT_TOKEN, 86400);
    const tgUser = await telegramAuth.validateInitData(initData);

    const displayName = getDisplayName(tgUser);
    const locale = resolveLocale(tgUser.language_code);

    // Upsert user into DB
    const existing = await db.select().from(users).where(eq(users.telegramId, tgUser.id)).limit(1);

    if (existing.length === 0) {
      await db.insert(users).values({
        telegramId: tgUser.id,
        username: tgUser.username ?? null,
        displayName,
      });
    } else {
      // Only write if fields actually changed (avoids unnecessary D1 writes)
      const needsUpdate =
        existing[0].displayName !== displayName ||
        existing[0].username !== (tgUser.username ?? null);
      if (needsUpdate) {
        await db
          .update(users)
          .set({
            username: tgUser.username ?? null,
            displayName,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(users.telegramId, tgUser.id));
      }
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, tgUser.id)).limit(1);

    // Auto-reclaim: check if a deletion-created placeholder exists for this user
    const dummyTelegramId = -Math.abs(tgUser.id);
    const [dummy] = await db
      .select()
      .from(users)
      .where(and(eq(users.telegramId, dummyTelegramId), eq(users.isDummy, true)))
      .limit(1);

    if (dummy) {
      // Get all groups the dummy is in
      const dummyMemberships = await db
        .select({
          groupId: groupMembers.groupId,
          role: groupMembers.role,
        })
        .from(groupMembers)
        .where(eq(groupMembers.userId, dummy.id));

      for (const dm of dummyMemberships) {
        // Check if real user is already a member of this group
        const [existingMembership] = await db
          .select({ id: groupMembers.id })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, dm.groupId), eq(groupMembers.userId, user.id)))
          .limit(1);

        if (!existingMembership) {
          // Add real user as member with dummy's role
          await db.insert(groupMembers).values({
            groupId: dm.groupId,
            userId: user.id,
            role: dm.role,
          });
        }
      }

      // Global FK transfer: dummy → real user
      await db.batch([
        db.update(expenses).set({ paidBy: user.id }).where(eq(expenses.paidBy, dummy.id)),
        db
          .update(expenseParticipants)
          .set({ userId: user.id })
          .where(eq(expenseParticipants.userId, dummy.id)),
        db.update(settlements).set({ fromUser: user.id }).where(eq(settlements.fromUser, dummy.id)),
        db.update(settlements).set({ toUser: user.id }).where(eq(settlements.toUser, dummy.id)),
        db
          .update(settlements)
          .set({ settledBy: user.id })
          .where(eq(settlements.settledBy, dummy.id)),
        db.update(activityLog).set({ actorId: user.id }).where(eq(activityLog.actorId, dummy.id)),
        db
          .update(activityLog)
          .set({ targetUserId: user.id })
          .where(eq(activityLog.targetUserId, dummy.id)),
        db.update(groups).set({ createdBy: user.id }).where(eq(groups.createdBy, dummy.id)),
        db
          .delete(debtReminders)
          .where(
            sql`(${debtReminders.fromUserId} = ${dummy.id} OR ${debtReminders.toUserId} = ${dummy.id})`,
          ),
        db.delete(groupMembers).where(eq(groupMembers.userId, dummy.id)),
      ]);

      // Transfer avatar if user doesn't have one but dummy does
      if (!user.avatarKey && dummy.avatarKey) {
        await db
          .update(users)
          .set({ avatarKey: dummy.avatarKey, updatedAt: new Date().toISOString() })
          .where(eq(users.id, user.id));
      }

      // Delete dummy user
      await db.delete(users).where(eq(users.id, dummy.id));

      // Refresh balances for all affected groups (fire-and-forget is fine here)
      // Note: we can't use waitUntil in auth handler since it's a plain function, not a Hono route
      // So do it synchronously — D1 writes are fast
      for (const dm of dummyMemberships) {
        await refreshGroupBalances(db, dm.groupId);
      }

      // Re-fetch user to get updated data (avatarKey may have changed)
      const [updatedUser] = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, tgUser.id))
        .limit(1);

      const isAdmin =
        !!c.env.ADMIN_TELEGRAM_ID && String(updatedUser.telegramId) === c.env.ADMIN_TELEGRAM_ID;
      return c.json({
        authenticated: true,
        user: {
          id: updatedUser.telegramId,
          displayName: updatedUser.displayName,
          username: updatedUser.username,
        },
        locale,
        isAdmin,
        source: 'initdata',
        reclaimed: true, // Signal to frontend that account was reclaimed
      });
    }

    const isAdmin =
      !!c.env.ADMIN_TELEGRAM_ID && String(user.telegramId) === c.env.ADMIN_TELEGRAM_ID;
    return c.json({
      authenticated: true,
      user: {
        id: user.telegramId,
        displayName: user.displayName,
        username: user.username,
      },
      locale,
      isAdmin,
      source: 'initdata',
    });
  } catch (error) {
    return c.json(
      {
        error: 'invalid_init_data',
        detail: error instanceof Error ? error.message : 'Invalid Telegram authentication',
      },
      401,
    );
  }
}
