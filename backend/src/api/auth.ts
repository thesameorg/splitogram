import { Context } from 'hono';
import { TelegramAuthService } from '../services/telegram-auth';
import { createDatabase } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { mockUser as devMockUser } from '../dev/mock-user';
import { getDisplayName } from '../models/telegram-user';
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
      await db
        .update(users)
        .set({
          username: tgUser.username ?? null,
          displayName,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.telegramId, tgUser.id));
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, tgUser.id)).limit(1);

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
