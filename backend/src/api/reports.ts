import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users, imageReports } from '../db/schema';
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

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (!user) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Store report in DB — callback_data uses the short report ID instead of the full R2 key
  const [report] = await db
    .insert(imageReports)
    .values({
      reporterTelegramId: user.telegramId,
      imageKey,
      reason,
      details: details ?? null,
    })
    .returning();

  const caption = [
    `🚩 Image Report #${report.id}`,
    `From: ${user.displayName} (${user.username ? `@${user.username}` : `ID: ${user.telegramId}`})`,
    `Reason: ${reason}`,
    details ? `Details: ${details}` : '',
    `Key: ${imageKey}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Read image from R2 and upload directly (Pages URL doesn't serve /r2/ routes)
  const sendReport = async () => {
    const r2Object = await c.env.IMAGES.get(imageKey);
    if (!r2Object) {
      console.error('Report: image not found in R2:', imageKey);
      return;
    }

    const blob = await r2Object.arrayBuffer();
    const formData = new FormData();
    formData.append('chat_id', String(parseInt(adminTelegramId, 10)));
    formData.append(
      'photo',
      new Blob([blob], { type: r2Object.httpMetadata?.contentType || 'image/jpeg' }),
      'reported-image.jpg',
    );
    formData.append('caption', caption);
    formData.append(
      'reply_markup',
      JSON.stringify({
        inline_keyboard: [
          [
            { text: '✅ Keep it', callback_data: `rj|${report.id}` },
            { text: '❌ Delete it', callback_data: `rm|${report.id}` },
          ],
        ],
      }),
    );

    const res = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Report sendPhoto failed:', res.status, body);
    }
  };

  c.executionCtx.waitUntil(
    sendReport().catch((e) => console.error('Report notification failed:', e)),
  );

  return c.json({ reported: true });
});

export { reportsApp };
