import { Bot } from 'grammy';

interface NotifyUser {
  telegramId: number;
  displayName: string;
}

interface NotifyContext {
  botToken: string;
  pagesUrl: string;
}

function formatAmount(microUsdt: number): string {
  const usdt = microUsdt / 1_000_000;
  return `$${usdt.toFixed(2)}`;
}

async function sendMessage(
  ctx: NotifyContext,
  telegramId: number,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; web_app?: { url: string }; url?: string }>>,
): Promise<void> {
  const bot = new Bot(ctx.botToken);

  const opts: any = { parse_mode: 'HTML' as const };
  if (inlineKeyboard) {
    opts.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  // Fire-and-forget with 1 bounded retry
  try {
    await bot.api.sendMessage(telegramId, text, {
      ...opts,
      signal: AbortSignal.timeout(5000),
    });
  } catch (firstError) {
    // 1 retry after 1s
    try {
      await new Promise((r) => setTimeout(r, 1000));
      await bot.api.sendMessage(telegramId, text, {
        ...opts,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      console.error(`Failed to notify user ${telegramId}:`, firstError);
    }
  }
}

export const notify = {
  async expenseCreated(
    ctx: NotifyContext,
    expense: { id: number; description: string; amount: number; groupId: number },
    payer: NotifyUser,
    participants: NotifyUser[],
    groupName: string,
  ): Promise<void> {
    const text =
      `<b>${payer.displayName}</b> added an expense in <b>${groupName}</b>\n` +
      `"${expense.description}" — ${formatAmount(expense.amount)}`;

    const keyboard = [
      [{ text: 'View Group', web_app: { url: `${ctx.pagesUrl}` } }],
    ];

    // Notify all participants except the payer
    const tasks = participants
      .filter((p) => p.telegramId !== payer.telegramId)
      .map((p) => sendMessage(ctx, p.telegramId, text, keyboard));

    await Promise.allSettled(tasks);
  },

  async settlementCompleted(
    ctx: NotifyContext,
    settlement: { id: number; amount: number; status: string; txHash?: string | null },
    debtor: NotifyUser,
    creditor: NotifyUser,
    groupName: string,
  ): Promise<void> {
    const amountStr = formatAmount(settlement.amount);
    const method = settlement.status === 'settled_onchain' ? 'on-chain' : 'externally';
    const txInfo = settlement.txHash ? `\nTx: <code>${settlement.txHash.slice(0, 16)}...</code>` : '';

    const creditorText =
      `<b>${debtor.displayName}</b> settled ${amountStr} with you ${method} in <b>${groupName}</b>${txInfo}`;

    const debtorText =
      `You settled ${amountStr} with <b>${creditor.displayName}</b> ${method} in <b>${groupName}</b>${txInfo}`;

    const keyboard = [
      [{ text: 'View Group', web_app: { url: `${ctx.pagesUrl}` } }],
    ];

    await Promise.allSettled([
      sendMessage(ctx, creditor.telegramId, creditorText, keyboard),
      sendMessage(ctx, debtor.telegramId, debtorText, keyboard),
    ]);
  },

  async memberJoined(
    ctx: NotifyContext,
    newMember: NotifyUser,
    existingMembers: NotifyUser[],
    groupName: string,
  ): Promise<void> {
    const text = `<b>${newMember.displayName}</b> joined <b>${groupName}</b>`;

    const keyboard = [
      [{ text: 'Open Group', web_app: { url: `${ctx.pagesUrl}` } }],
    ];

    const tasks = existingMembers
      .filter((m) => m.telegramId !== newMember.telegramId)
      .map((m) => sendMessage(ctx, m.telegramId, text, keyboard));

    await Promise.allSettled(tasks);
  },
};
