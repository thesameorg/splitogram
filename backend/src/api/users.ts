import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { generateR2Key, safeR2Delete, validateUpload } from '../utils/r2';
import { notify } from '../services/notifications';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';
import type { Env } from '../env';

type UsersEnv = AuthContext & DBContext & { Bindings: Env };
const app = new Hono<UsersEnv>();

// GET /api/v1/users/me — return current user profile
app.get('/me', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

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
      displayName: z.string().min(1).max(64),
    }),
  ),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const { displayName } = c.req.valid('json');

    await db
      .update(users)
      .set({ displayName, updatedAt: new Date().toISOString() })
      .where(eq(users.telegramId, session.telegramId));

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
    .where(eq(users.telegramId, session.telegramId))
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
    .where(eq(users.telegramId, session.telegramId))
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
    return c.json({ error: 'invalid_message', detail: 'Message is required (max 2000 chars)' }, 400);
  }

  const adminTelegramId = c.env.ADMIN_TELEGRAM_ID;
  if (!adminTelegramId) {
    return c.json({ sent: true }); // silently succeed if no admin configured
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

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

  // Collect attachment files (attachment_0..4)
  const attachments: File[] = [];
  for (let i = 0; i < 5; i++) {
    const file = body[`attachment_${i}`];
    if (file instanceof File) attachments.push(file);
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
        for (const file of attachments) {
          const formData = new FormData();
          formData.append('chat_id', String(chatId));
          const isImage = file.type.startsWith('image/');
          const endpoint = isImage ? 'sendPhoto' : 'sendDocument';
          formData.append(isImage ? 'photo' : 'document', file, file.name);

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

export const usersApp = app;
