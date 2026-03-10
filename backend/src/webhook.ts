import { Context } from 'hono';
import { Bot, webhookCallback, Context as GrammyContext } from 'grammy';
import { createDatabase } from './db';
import { users, groups, groupMembers, expenses, settlements, imageReports } from './db/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { logActivity } from './services/activity';
import { refreshGroupBalances } from './api/balances';
import { removeImage } from './services/moderation';
import type { Env } from './env';

// Module-level bot cache — reused across requests within the same isolate
let cachedBot: Bot | null = null;
let cachedToken: string | null = null;

// Updated per-request before webhook processing.
// Handlers read this at call time (not registration time) via closure.
// NOTE: This is safe because CF Workers env bindings are identical across all requests
// to the same worker deployment. The values never differ between concurrent requests.
let currentEnv: Env;

function getOrCreateBot(botToken: string): Bot {
  if (cachedBot && cachedToken === botToken) return cachedBot;

  const bot = new Bot(botToken);

  bot.command('start', async (ctx: GrammyContext) => {
    const firstName = ctx.from?.first_name ?? 'User';
    const payload = ctx.match; // deep link parameter after /start

    // Handle personalized placeholder invite: /start jp_{inviteCode}_{placeholderId}
    // Also handles regular join: /start join_{inviteCode}
    const isPersonalized = typeof payload === 'string' && payload.startsWith('jp_');
    const isJoin = typeof payload === 'string' && payload.startsWith('join_');

    if (isPersonalized || isJoin) {
      let inviteCode: string;
      let placeholderId: number | null = null;

      if (isPersonalized) {
        const rest = (payload as string).substring(3);
        const sepIdx = rest.indexOf('_');
        inviteCode = sepIdx > 0 ? rest.substring(0, sepIdx) : '';
        placeholderId = sepIdx > 0 ? parseInt(rest.substring(sepIdx + 1), 10) : NaN;
        if (!inviteCode || isNaN(placeholderId as number)) {
          await ctx.reply('Sorry, that invite link is invalid.');
          return;
        }
      } else {
        inviteCode = (payload as string).substring(5);
      }

      const db = createDatabase(currentEnv.DB);

      // Look up group
      const [group] = await db
        .select()
        .from(groups)
        .where(and(eq(groups.inviteCode, inviteCode), isNull(groups.deletedAt)))
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

      const groupUrl = `${currentEnv.PAGES_URL ?? ''}/groups/${group.id}`;
      const groupUrlWithClaim =
        placeholderId != null
          ? `${groupUrl}?joined=1&claim=${placeholderId}`
          : `${groupUrl}?joined=1`;

      if (alreadyMember) {
        // For personalized links, still offer to open the group with claim param
        const url = placeholderId != null ? `${groupUrl}?claim=${placeholderId}` : groupUrl;
        await ctx.reply(`You're already in "${group.name}".`, {
          reply_markup: {
            inline_keyboard: [[{ text: `Open ${group.name} \u2192`, web_app: { url } }]],
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

      // Refresh cached balances
      await refreshGroupBalances(db, group.id);

      // Log activity
      await logActivity(db, {
        groupId: group.id,
        actorId: user.id,
        type: 'member_joined',
      });

      // Count members after join
      const [{ count: memberCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, group.id));

      await ctx.reply(
        `\u2713 You joined "${group.name}" (${memberCount} ${memberCount === 1 ? 'member' : 'members'})`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `Open ${group.name} \u2192`, web_app: { url: groupUrlWithClaim } }],
            ],
          },
        },
      );
      return;
    }

    // Mark bot as started for this user
    const defaultTgId = ctx.from?.id;
    if (defaultTgId) {
      const db = createDatabase(currentEnv.DB);
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
                web_app: { url: `${currentEnv.PAGES_URL ?? ''}` },
              },
            ],
          ],
        },
      },
    );
  });

  // Admin /stats command
  bot.command('stats', async (ctx: GrammyContext) => {
    const adminTgId = currentEnv.ADMIN_TELEGRAM_ID;
    if (!adminTgId || String(ctx.from?.id) !== adminTgId) return;

    const db = createDatabase(currentEnv.DB);
    const [{ total: totalUsers }] = await db.select({ total: sql<number>`count(*)` }).from(users);
    const [{ total: dummyUsers }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.isDummy, true));
    const realUsers = totalUsers - dummyUsers;
    const [{ total: groupCount }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(groups)
      .where(isNull(groups.deletedAt));
    const [{ total: deletedGroupCount }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(groups)
      .where(sql`${groups.deletedAt} IS NOT NULL`);
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

    const network = currentEnv.TON_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

    await ctx.reply(
      `<b>Splitogram Stats</b>\n\n` +
        `Users: <b>${realUsers}</b>${dummyUsers > 0 ? ` (+${dummyUsers} placeholders)` : ''}\n` +
        `Groups: <b>${groupCount}</b>${deletedGroupCount > 0 ? ` (+${deletedGroupCount} deleted)` : ''}\n` +
        `Expenses: <b>${expenseCount}</b>\n` +
        `Settlements: <b>${settlementCount}</b>\n` +
        `Active groups (7d): <b>${activeGroups7d}</b>\n\n` +
        `<b>TON Settlements</b> [${network}]\n` +
        `On-chain: <b>${onchainCount}</b>\n` +
        `Volume: <b>~$${volumeStr}</b>\n` +
        `Fees earned: <b>~$${feesStr}</b>`,
      { parse_mode: 'HTML' },
    );
  });

  // Report moderation: admin taps Reject or Remove
  // callback_data format: "rj|{reportId}" or "rm|{reportId}"
  bot.on('callback_query:data', async (ctx: GrammyContext) => {
    try {
      const data = ctx.callbackQuery?.data;
      if (!data) return;

      const parts = data.split('|');
      if (parts.length !== 2) return;

      const [action, reportIdStr] = parts;
      const reportId = parseInt(reportIdStr, 10);
      if (isNaN(reportId)) return;

      const db = createDatabase(currentEnv.DB);
      const botToken = currentEnv.TELEGRAM_BOT_TOKEN;

      // Look up report from DB
      const [report] = await db
        .select()
        .from(imageReports)
        .where(eq(imageReports.id, reportId))
        .limit(1);

      if (!report) {
        await ctx.answerCallbackQuery({ text: 'Report not found' });
        return;
      }

      if (report.status !== 'pending') {
        await ctx.answerCallbackQuery({ text: 'Already processed' });
        return;
      }

      const reporterTgId = report.reporterTelegramId;
      const imageKey = report.imageKey;

      if (action === 'rj') {
        // Reject — update report, notify reporter, update caption
        await db
          .update(imageReports)
          .set({ status: 'rejected' })
          .where(eq(imageReports.id, reportId));

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
        // Remove — update report, delete from R2, notify reporter, update caption
        await db
          .update(imageReports)
          .set({ status: 'removed' })
          .where(eq(imageReports.id, reportId));

        await removeImage(currentEnv.IMAGES, db, imageKey);

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
    } catch (e) {
      console.error('Callback query handler error:', e);
      await ctx.answerCallbackQuery({ text: 'Error processing request' }).catch(() => {});
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
                web_app: { url: `${currentEnv.PAGES_URL ?? ''}` },
              },
            ],
          ],
        },
      });
    }
  });

  cachedBot = bot;
  cachedToken = botToken;
  return bot;
}

/**
 * Derive a webhook secret token from the bot token.
 * Used as `secret_token` when setting webhook and verified via
 * `X-Telegram-Bot-Api-Secret-Token` header on incoming requests.
 */
async function deriveWebhookSecret(botToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebhookSecret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(botToken));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 64);
}

/** Exported for webhook setup scripts to generate the same secret. */
export { deriveWebhookSecret };

export async function handleWebhook(c: Context) {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: 'bot_not_configured', detail: 'Bot token not configured' }, 500);
  }

  // Verify Telegram's secret token header
  const expectedSecret = await deriveWebhookSecret(botToken);
  const receivedSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (receivedSecret !== expectedSecret) {
    return c.json({ error: 'unauthorized', detail: 'Invalid webhook secret' }, 401);
  }

  if (!c.env.PAGES_URL) {
    console.warn('PAGES_URL is not set — bot buttons will link to empty URLs');
  }

  // Set env for this request — handlers will read from currentEnv
  currentEnv = c.env;

  const bot = getOrCreateBot(botToken);
  return webhookCallback(bot, 'hono')(c);
}
