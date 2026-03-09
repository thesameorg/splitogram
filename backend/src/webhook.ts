import { Context } from 'hono';
import { Bot, webhookCallback, Context as GrammyContext } from 'grammy';
import { createDatabase } from './db';
import { users, groups, groupMembers, expenses, settlements } from './db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logActivity } from './services/activity';
import { removeImage } from './services/moderation';

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

  // Admin /stats command
  bot.command('stats', async (ctx: GrammyContext) => {
    const adminTgId = c.env.ADMIN_TELEGRAM_ID;
    if (!adminTgId || String(ctx.from?.id) !== adminTgId) return;

    const db = createDatabase(c.env.DB);
    const [{ total: totalUsers }] = await db.select({ total: sql<number>`count(*)` }).from(users);
    const [{ total: dummyUsers }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.isDummy, true));
    const realUsers = totalUsers - dummyUsers;
    const [{ total: groupCount }] = await db.select({ total: sql<number>`count(*)` }).from(groups);
    const [{ total: expenseCount }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(expenses);
    const [{ total: settlementCount }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(settlements);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [{ total: activeGroups7d }] = await db
      .select({ total: sql<number>`count(distinct ${expenses.groupId})` })
      .from(expenses)
      .where(sql`${expenses.createdAt} > ${sevenDaysAgo}`);

    // TON on-chain settlement stats (uses stored usdt_amount + commission)
    const [onchainStats] = await db
      .select({
        count: sql<number>`count(*)`,
        volume: sql<number>`coalesce(sum(${settlements.usdtAmount}), 0)`,
        fees: sql<number>`coalesce(sum(${settlements.commission}), 0)`,
      })
      .from(settlements)
      .where(eq(settlements.status, 'settled_onchain'));

    const onchainCount = onchainStats.count;
    const volumeStr = (onchainStats.volume / 1_000_000).toFixed(2);
    const feesStr = (onchainStats.fees / 1_000_000).toFixed(2);

    await ctx.reply(
      `<b>Splitogram Stats</b>\n\n` +
        `Users: <b>${realUsers}</b>${dummyUsers > 0 ? ` (+${dummyUsers} placeholders)` : ''}\n` +
        `Groups: <b>${groupCount}</b>\n` +
        `Expenses: <b>${expenseCount}</b>\n` +
        `Settlements: <b>${settlementCount}</b>\n` +
        `Active groups (7d): <b>${activeGroups7d}</b>\n\n` +
        `<b>TON Settlements</b>\n` +
        `On-chain: <b>${onchainCount}</b>\n` +
        `Volume: <b>~$${volumeStr}</b>\n` +
        `Fees earned: <b>~$${feesStr}</b>`,
      { parse_mode: 'HTML' },
    );
  });

  // Report moderation: admin taps Reject or Remove
  bot.on('callback_query:data', async (ctx: GrammyContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const parts = data.split('|');
    if (parts.length !== 3) return;

    const [action, reporterTgIdStr, imageKey] = parts;
    const reporterTgId = parseInt(reporterTgIdStr, 10);
    if (isNaN(reporterTgId)) return;

    const botToken = c.env.TELEGRAM_BOT_TOKEN;

    if (action === 'rj') {
      // Reject — notify reporter, update caption
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: reporterTgId,
          text: 'Your report has been reviewed. The image was not found to violate our guidelines.',
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});

      const msgId = ctx.callbackQuery?.message?.message_id;
      const chatId = ctx.callbackQuery?.message?.chat.id;
      const oldCaption = (ctx.callbackQuery?.message as any)?.caption || '';
      if (msgId && chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/editMessageCaption`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: msgId,
            caption: `${oldCaption}\n\n✅ Rejected by admin`,
          }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }

      await ctx.answerCallbackQuery({ text: 'Rejected' });
    } else if (action === 'rm') {
      // Remove — delete from R2 + DB reference, notify reporter, update caption
      const db = createDatabase(c.env.DB);
      await removeImage(c.env.IMAGES, db, imageKey);

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: reporterTgId,
          text: 'Your report has been reviewed. The image has been removed.',
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});

      const msgId = ctx.callbackQuery?.message?.message_id;
      const chatId = ctx.callbackQuery?.message?.chat.id;
      const oldCaption = (ctx.callbackQuery?.message as any)?.caption || '';
      if (msgId && chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/editMessageCaption`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: msgId,
            caption: `${oldCaption}\n\n🗑 Removed by admin`,
          }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }

      await ctx.answerCallbackQuery({ text: 'Removed' });
    }
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
