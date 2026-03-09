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

const KV_AUTH_TTL = 86400; // 24h — matches initData max age

function kvAuthKey(telegramId: number): string {
  return `user:tg:${telegramId}`;
}

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
  // DEV MODE: skip HMAC, use mock user from D1
  if (c.env.DEV_AUTH_BYPASS_ENABLED === 'true') {
    const initData = extractInitData(c);
    if (!initData) {
      const db = createDatabase(c.env.DB);
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
          userId: created.id,
        });
      } else {
        c.set('session', {
          telegramId: existing[0].telegramId,
          userId: existing[0].id,
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

    // Try KV cache first
    if (c.env.KV) {
      const cached = await c.env.KV.get<{ userId: number }>(kvAuthKey(tgUser.id), 'json');
      if (cached) {
        c.set('session', {
          telegramId: tgUser.id,
          userId: cached.userId,
        });
        await next();
        return;
      }
    }

    // KV miss — look up user in D1
    const db = createDatabase(c.env.DB);
    const existing = await db.select().from(users).where(eq(users.telegramId, tgUser.id)).limit(1);

    if (existing.length === 0) {
      return c.json(
        { error: 'user_not_found', detail: 'User not registered. Call POST /api/v1/auth first.' },
        401,
      );
    }

    // Populate KV cache (fire-and-forget)
    if (c.env.KV) {
      c.executionCtx.waitUntil(
        c.env.KV.put(kvAuthKey(tgUser.id), JSON.stringify({ userId: existing[0].id }), {
          expirationTtl: KV_AUTH_TTL,
        }),
      );
    }

    c.set('session', {
      telegramId: existing[0].telegramId,
      userId: existing[0].id,
    });
  } catch {
    return c.json({ error: 'invalid_init_data', detail: 'Invalid or expired authentication' }, 401);
  }

  await next();
}

/**
 * Invalidate the KV auth cache for a given telegramId.
 * Call this on account delete or placeholder claim.
 */
export async function invalidateAuthCache(kv: Env['KV'], telegramId: number): Promise<void> {
  if (kv) {
    await kv.delete(kvAuthKey(telegramId));
  }
}
