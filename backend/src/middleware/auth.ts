import { Context, Next } from 'hono';
import { TelegramAuthService } from '../services/telegram-auth';
import { createDatabase } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { mockUser } from '../dev/mock-user';
import { getDisplayName } from '../models/telegram-user';
import type { Env, SessionData } from '../env';

export type AuthContext = {
  Bindings: Env;
  Variables: {
    session: SessionData;
  };
};

function extractInitData(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    const trimmed = authHeader.trim();
    if (trimmed.startsWith('tma ')) return trimmed.substring(4).trim();
    if (trimmed.startsWith('Bearer ')) return trimmed.substring(7).trim();
    return trimmed;
  }
  return null;
}

export async function authMiddleware(c: Context<AuthContext>, next: Next) {
  const db = createDatabase(c.env.DB);

  // DEV MODE: skip HMAC, use mock user from D1
  if (c.env.DEV_AUTH_BYPASS_ENABLED === 'true') {
    const initData = extractInitData(c);
    if (!initData) {
      // No auth header — use mock dev user
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, mockUser.id))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(users).values({
          telegramId: mockUser.id,
          username: mockUser.username ?? null,
          displayName: getDisplayName(mockUser),
        });
        const [created] = await db
          .select()
          .from(users)
          .where(eq(users.telegramId, mockUser.id))
          .limit(1);
        c.set('session', {
          telegramId: created.telegramId,
          username: created.username ?? undefined,
          displayName: created.displayName,
        });
      } else {
        c.set('session', {
          telegramId: existing[0].telegramId,
          username: existing[0].username ?? undefined,
          displayName: existing[0].displayName,
        });
      }
      await next();
      return;
    }
  }

  const initData = extractInitData(c);
  if (!initData) {
    return c.json({ error: 'auth_required', detail: 'Authentication required' }, 401);
  }

  try {
    const telegramAuth = new TelegramAuthService(c.env.TELEGRAM_BOT_TOKEN, 86400);
    const tgUser = await telegramAuth.validateInitData(initData);

    // Look up user in D1
    const existing = await db.select().from(users).where(eq(users.telegramId, tgUser.id)).limit(1);

    if (existing.length === 0) {
      return c.json(
        { error: 'user_not_found', detail: 'User not registered. Call POST /api/v1/auth first.' },
        401,
      );
    }

    c.set('session', {
      telegramId: existing[0].telegramId,
      username: existing[0].username ?? undefined,
      displayName: existing[0].displayName,
    });
  } catch {
    return c.json({ error: 'invalid_init_data', detail: 'Invalid or expired authentication' }, 401);
  }

  await next();
}
