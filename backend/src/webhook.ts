import { Context } from 'hono';
import { Bot, webhookCallback, Context as GrammyContext } from 'grammy';
import { createDatabase } from './db';
import { users, groups, groupMembers } from './db/schema';
import { eq, and } from 'drizzle-orm';
import { logActivity } from './services/activity';

export async function handleWebhook(c: Context) {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: 'bot_not_configured', detail: 'Bot token not configured' }, 500);
  }

  if (!c.env.PAGES_URL) {
    console.warn('PAGES_URL is not set — bot buttons will link to empty URLs');
  }

  const bot = new Bot(botToken);

  bot.command('start', async (ctx: GrammyContext) => {
    const firstName = ctx.from?.first_name ?? 'User';
    const payload = ctx.match; // deep link parameter after /start

    // Handle join deep link: /start join_{invite_code}
    if (typeof payload === 'string' && payload.startsWith('join_')) {
      const inviteCode = payload.substring(5);
      const db = createDatabase(c.env.DB);

      // Look up group
      const [group] = await db
        .select()
        .from(groups)
        .where(eq(groups.inviteCode, inviteCode))
        .limit(1);

      if (!group) {
        await ctx.reply('Sorry, that invite link is invalid or expired.');
        return;
      }

      // Ensure user exists in DB
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      let [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

      if (!user) {
        const [inserted] = await db
          .insert(users)
          .values({
            telegramId,
            username: ctx.from?.username ?? null,
            displayName: firstName,
            botStarted: true,
          })
          .returning();
        user = inserted;
      } else if (!user.botStarted) {
        await db.update(users).set({ botStarted: true }).where(eq(users.id, user.id));
      }

      // Check if already a member
      const [existingMember] = await db
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, user.id)))
        .limit(1);

      const alreadyMember = !!existingMember;

      const groupUrl = `${c.env.PAGES_URL ?? ''}/groups/${group.id}`;

      if (alreadyMember) {
        await ctx.reply(`You're already in "${group.name}"! Open the app to see your expenses.`, {
          reply_markup: {
            inline_keyboard: [[{ text: `Open "${group.name}"`, web_app: { url: groupUrl } }]],
          },
        });
        return;
      }

      // Join the group
      await db.insert(groupMembers).values({
        groupId: group.id,
        userId: user.id,
        role: 'member',
      });

      // Log activity
      await logActivity(db, {
        groupId: group.id,
        actorId: user.id,
        type: 'member_joined',
      });

      await ctx.reply(`You've joined "${group.name}"! Open the app to start splitting expenses.`, {
        reply_markup: {
          inline_keyboard: [[{ text: `Open "${group.name}"`, web_app: { url: groupUrl } }]],
        },
      });
      return;
    }

    // Mark bot as started for this user
    const defaultTgId = ctx.from?.id;
    if (defaultTgId) {
      const db = createDatabase(c.env.DB);
      await db.update(users).set({ botStarted: true }).where(eq(users.telegramId, defaultTgId));
    }

    // Default /start response
    await ctx.reply(
      `Hey ${firstName}! Welcome to Splitogram.\n\nSplit expenses with friends and settle up easily.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Open Splitogram',
                web_app: { url: `${c.env.PAGES_URL ?? ''}` },
              },
            ],
          ],
        },
      },
    );
  });

  bot.on('message:text', async (ctx: GrammyContext) => {
    if (ctx.message && !ctx.message.text?.startsWith('/')) {
      await ctx.reply('Use the button below to open Splitogram.', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Open Splitogram',
                web_app: { url: `${c.env.PAGES_URL ?? ''}` },
              },
            ],
          ],
        },
      });
    }
  });

  return webhookCallback(bot, 'hono')(c);
}
