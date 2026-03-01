import { Api, GrammyError } from 'grammy';
import { formatAmount } from '../utils/format';

interface NotifyUser {
  telegramId: number;
  displayName: string;
  botStarted?: boolean;
}

interface NotifyContext {
  botToken: string;
  pagesUrl: string;
  onBotBlocked?: (telegramId: number) => void;
}

function createApi(ctx: NotifyContext): Api {
  return new Api(ctx.botToken);
}

async function sendMessage(
  api: Api,
  ctx: NotifyContext,
  telegramId: number,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; web_app?: { url: string }; url?: string }>>,
): Promise<void> {
  const opts: any = { parse_mode: 'HTML' as const };
  if (inlineKeyboard) {
    opts.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  // Fire-and-forget with 1 bounded retry
  try {
    await api.sendMessage(telegramId, text, {
      ...opts,
      signal: AbortSignal.timeout(5000),
    });
  } catch (firstError) {
    // 403 = user blocked bot or never started it — don't retry
    if (firstError instanceof GrammyError && firstError.error_code === 403) {
      ctx.onBotBlocked?.(telegramId);
      return;
    }
    // 1 retry after 1s for other errors
    try {
      await new Promise((r) => setTimeout(r, 1000));
      await api.sendMessage(telegramId, text, {
        ...opts,
        signal: AbortSignal.timeout(5000),
      });
    } catch (retryError) {
      if (retryError instanceof GrammyError && retryError.error_code === 403) {
        ctx.onBotBlocked?.(telegramId);
        return;
      }
      console.error(`Failed to notify user ${telegramId}:`, firstError);
    }
  }
}

function canNotify(user: NotifyUser): boolean {
  return user.botStarted !== false;
}

export const notify = {
  async expenseCreated(
    ctx: NotifyContext,
    expense: { id: number; description: string; amount: number; groupId: number },
    payer: NotifyUser,
    participants: (NotifyUser & { muted?: boolean })[],
    groupName: string,
    currency: string = 'USD',
  ): Promise<void> {
    const api = createApi(ctx);
    const text =
      `<b>${payer.displayName}</b> added an expense in <b>${groupName}</b>\n` +
      `"${expense.description}" — ${formatAmount(expense.amount, currency)}`;

    const keyboard = [
      [{ text: 'View Group', web_app: { url: `${ctx.pagesUrl}/groups/${expense.groupId}` } }],
    ];

    // Notify participants except payer, skipping muted and bot-not-started
    const tasks = participants
      .filter((p) => p.telegramId !== payer.telegramId && !p.muted && canNotify(p))
      .map((p) => sendMessage(api, ctx, p.telegramId, text, keyboard));

    await Promise.allSettled(tasks);
  },

  async settlementCompleted(
    ctx: NotifyContext,
    settlement: {
      id: number;
      amount: number;
      status: string;
      txHash?: string | null;
      groupId: number;
    },
    debtor: NotifyUser,
    creditor: NotifyUser,
    groupName: string,
    currency: string = 'USD',
  ): Promise<void> {
    const api = createApi(ctx);
    const amountStr = formatAmount(settlement.amount, currency);
    const method = settlement.status === 'settled_onchain' ? 'on-chain' : 'externally';
    const txInfo = settlement.txHash
      ? `\nTx: <code>${settlement.txHash.slice(0, 16)}...</code>`
      : '';

    const creditorText = `<b>${debtor.displayName}</b> settled ${amountStr} with you ${method} in <b>${groupName}</b>${txInfo}`;

    const debtorText = `You settled ${amountStr} with <b>${creditor.displayName}</b> ${method} in <b>${groupName}</b>${txInfo}`;

    const keyboard = [
      [{ text: 'View Group', web_app: { url: `${ctx.pagesUrl}/groups/${settlement.groupId}` } }],
    ];

    const tasks = [];
    if (canNotify(creditor)) {
      tasks.push(sendMessage(api, ctx, creditor.telegramId, creditorText, keyboard));
    }
    if (canNotify(debtor)) {
      tasks.push(sendMessage(api, ctx, debtor.telegramId, debtorText, keyboard));
    }
    await Promise.allSettled(tasks);
  },

  async debtReminder(
    ctx: NotifyContext,
    creditor: { displayName: string },
    debtor: NotifyUser,
    group: { id: number; name: string },
    amount: number,
    currency: string = 'USD',
  ): Promise<void> {
    if (!canNotify(debtor)) return;
    const api = createApi(ctx);
    const amountStr = formatAmount(amount, currency);
    const text = `<b>${creditor.displayName}</b> is reminding you about a debt of ${amountStr} in <b>${group.name}</b>`;

    const keyboard = [
      [{ text: 'View Group', web_app: { url: `${ctx.pagesUrl}/groups/${group.id}` } }],
    ];

    await sendMessage(api, ctx, debtor.telegramId, text, keyboard);
  },

  async memberJoined(
    ctx: NotifyContext,
    newMember: NotifyUser,
    existingMembers: NotifyUser[],
    group: { id: number; name: string },
  ): Promise<void> {
    const api = createApi(ctx);
    const text = `<b>${newMember.displayName}</b> joined <b>${group.name}</b>`;

    const keyboard = [
      [{ text: 'Open Group', web_app: { url: `${ctx.pagesUrl}/groups/${group.id}` } }],
    ];

    const tasks = existingMembers
      .filter((m) => m.telegramId !== newMember.telegramId && canNotify(m))
      .map((m) => sendMessage(api, ctx, m.telegramId, text, keyboard));

    await Promise.allSettled(tasks);
  },
};
