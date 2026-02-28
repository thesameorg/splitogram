import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type UsersEnv = AuthContext & DBContext;
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

export const usersApp = app;
