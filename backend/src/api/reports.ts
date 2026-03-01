import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';
import type { Env } from '../env';

type ReportsEnv = AuthContext & DBContext & { Bindings: Env };

const reportsApp = new Hono<ReportsEnv>();

const reportSchema = z.object({
  imageKey: z.string().min(1),
  reason: z.enum(['inappropriate', 'spam', 'personal_info', 'copyright', 'other']),
  details: z.string().max(500).optional(),
});

reportsApp.post('/', zValidator('json', reportSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { imageKey, reason, details } = c.req.valid('json');

  const adminTelegramId = c.env.ADMIN_TELEGRAM_ID;
  if (!adminTelegramId) {
    return c.json({ reported: true }); // silently succeed if no admin configured
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const pagesUrl = c.env.PAGES_URL || '';
  const imageFullUrl = `${pagesUrl}/r2/${imageKey}`;

  const text = [
    `🚩 Image Report`,
    `From: ${user.displayName} (${user.username ? `@${user.username}` : `ID: ${user.telegramId}`})`,
    `Reason: ${reason}`,
    details ? `Details: ${details}` : '',
    `Image: ${imageFullUrl}`,
    `Key: ${imageKey}`,
  ]
    .filter(Boolean)
    .join('\n');

  c.executionCtx.waitUntil(
    fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(adminTelegramId, 10),
        text,
      }),
      signal: AbortSignal.timeout(10000),
    }).catch((e) => console.error('Report notification failed:', e)),
  );

  return c.json({ reported: true });
});

export { reportsApp };
