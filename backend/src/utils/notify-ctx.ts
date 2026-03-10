import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Database } from '../db';
import type { Env } from '../env';

export function makeNotifyCtx(env: Env, db: Database) {
  return {
    botToken: env.TELEGRAM_BOT_TOKEN,
    pagesUrl: env.PAGES_URL || '',
    onBotBlocked: (telegramId: number) => {
      db.update(users)
        .set({ botStarted: false })
        .where(eq(users.telegramId, telegramId))
        .catch(() => {});
    },
  };
}
