import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { settlements, groupMembers, users, groups } from '../db/schema';
import { simplifyDebts } from '../services/debt-solver';
import { computeGroupBalances } from './balances';
import { notify } from '../services/notifications';
import { logActivity } from '../services/activity';
import { generateR2Key, safeR2Delete, validateUpload } from '../utils/r2';
import type { Database } from '../db';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';
import type { Env } from '../env';

type SettlementEnv = AuthContext & DBContext & { Bindings: Env };

const settlementsApp = new Hono<SettlementEnv>();

// --- Create settlement for a specific debt ---
const createSettlementSchema = z.object({
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
});

settlementsApp.post(
  '/groups/:id/settlements',
  zValidator('json', createSettlementSchema),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const groupId = parseInt(c.req.param('id'), 10);
    const { fromUserId, toUserId } = c.req.valid('json');

    if (isNaN(groupId)) {
      return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
    }

    const [currentUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, session.telegramId))
      .limit(1);

    if (!currentUser) {
      return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
    }

    // Current user must be one of the parties
    if (currentUser.id !== fromUserId && currentUser.id !== toUserId) {
      return c.json({ error: 'not_involved', detail: 'You must be the debtor or creditor' }, 403);
    }

    // Check membership
    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
      .limit(1);

    if (!membership) {
      return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
    }

    // Compute current debt graph and find the specific debt
    const netBalances = await computeGroupBalances(db, groupId);
    const debts = simplifyDebts(netBalances);
    const targetDebt = debts.find((d) => d.from === fromUserId && d.to === toUserId);

    if (!targetDebt) {
      return c.json({ error: 'no_debt', detail: 'No outstanding debt between these users' }, 400);
    }

    // Idempotent: check for existing open settlement
    const [existing] = await db
      .select()
      .from(settlements)
      .where(
        and(
          eq(settlements.groupId, groupId),
          eq(settlements.fromUser, fromUserId),
          eq(settlements.toUser, toUserId),
          eq(settlements.status, 'open'),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.amount !== targetDebt.amount) {
        await db
          .update(settlements)
          .set({ amount: targetDebt.amount, updatedAt: new Date().toISOString() })
          .where(eq(settlements.id, existing.id));
      }
      return c.json({ settlement: { ...existing, amount: targetDebt.amount } }, 200);
    }

    const [settlement] = await db
      .insert(settlements)
      .values({
        groupId,
        fromUser: fromUserId,
        toUser: toUserId,
        amount: targetDebt.amount,
        status: 'open',
      })
      .returning();

    return c.json({ settlement }, 201);
  },
);

// --- List completed settlements for a group ---
settlementsApp.get('/groups/:id/settlements', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;

  // Check membership
  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  // Fetch completed settlements
  const rows = await db
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        sql`${settlements.status} IN ('settled_external', 'settled_onchain')`,
      ),
    )
    .orderBy(desc(settlements.createdAt))
    .limit(limit)
    .offset(offset);

  if (rows.length === 0) {
    return c.json({ settlements: [] });
  }

  // Batch-fetch user display names
  const userIds = [...new Set(rows.flatMap((r) => [r.fromUser, r.toUser]))];
  const userRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, userIds));

  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));

  const result = rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    fromUser: r.fromUser,
    fromUserName: userMap.get(r.fromUser) ?? 'Unknown',
    toUser: r.toUser,
    toUserName: userMap.get(r.toUser) ?? 'Unknown',
    amount: r.amount,
    status: r.status,
    comment: r.comment,
    receiptKey: r.receiptKey,
    receiptThumbKey: r.receiptThumbKey,
    createdAt: r.createdAt,
  }));

  return c.json({ settlements: result });
});

// --- Get settlement detail ---
settlementsApp.get('/settlements/:id', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const settlementId = parseInt(c.req.param('id'), 10);

  if (isNaN(settlementId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid settlement ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  // Check user is involved (debtor or creditor)
  if (settlement.fromUser !== currentUser.id && settlement.toUser !== currentUser.id) {
    return c.json(
      { error: 'not_involved', detail: 'You are not involved in this settlement' },
      403,
    );
  }

  // Get user details and group currency
  const [[fromUserInfo], [toUserInfo], [group]] = await Promise.all([
    db
      .select({
        displayName: users.displayName,
        username: users.username,
        walletAddress: users.walletAddress,
      })
      .from(users)
      .where(eq(users.id, settlement.fromUser))
      .limit(1),
    db
      .select({
        displayName: users.displayName,
        username: users.username,
        walletAddress: users.walletAddress,
      })
      .from(users)
      .where(eq(users.id, settlement.toUser))
      .limit(1),
    db
      .select({ currency: groups.currency })
      .from(groups)
      .where(eq(groups.id, settlement.groupId))
      .limit(1),
  ]);

  const result = {
    ...settlement,
    currentUserId: currentUser.id,
    currency: group?.currency ?? 'USD',
    from: { userId: settlement.fromUser, ...fromUserInfo },
    to: { userId: settlement.toUser, ...toUserInfo },
  };

  // Lazy verification: if payment_pending, try to verify on-chain
  if (settlement.status === 'payment_pending' && toUserInfo?.walletAddress) {
    const pendingSince = new Date(settlement.updatedAt).getTime();
    const now = Date.now();
    const PENDING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    if (now - pendingSince > PENDING_TIMEOUT_MS) {
      // Timeout: rollback to open
      await db
        .update(settlements)
        .set({ status: 'open', updatedAt: new Date().toISOString() })
        .where(eq(settlements.id, settlementId));
      result.status = 'open';
    } else {
      // Try to verify on-chain
      const verification = await verifySettlementOnChain(
        c.env,
        settlement,
        toUserInfo.walletAddress,
      );
      if (verification.verified) {
        await db
          .update(settlements)
          .set({
            status: 'settled_onchain',
            txHash: verification.txHash ?? null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(settlements.id, settlementId));
        result.status = 'settled_onchain';
        result.txHash = verification.txHash ?? null;

        // Fire-and-forget notification + activity log
        const notifyCtx = {
          botToken: c.env.TELEGRAM_BOT_TOKEN,
          pagesUrl: c.env.PAGES_URL || '',
          onBotBlocked: (telegramId: number) => {
            db.update(users)
              .set({ botStarted: false })
              .where(eq(users.telegramId, telegramId))
              .catch(() => {});
          },
        };
        c.executionCtx.waitUntil(
          Promise.all([
            sendSettlementNotification(
              notifyCtx,
              db,
              {
                id: settlementId,
                amount: settlement.amount,
                status: 'settled_onchain',
                txHash: verification.txHash,
              },
              settlement.fromUser,
              settlement.toUser,
              settlement.groupId,
            ),
            logActivity(db, {
              groupId: settlement.groupId,
              actorId: settlement.fromUser,
              type: 'settlement_completed',
              settlementId,
              targetUserId: settlement.toUser,
              amount: settlement.amount,
            }),
          ]),
        );
      }
    }
  }

  return c.json(result);
});

// --- Get transaction params for settlement ---
settlementsApp.get('/settlements/:id/tx', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const settlementId = parseInt(c.req.param('id'), 10);
  const senderAddress = c.req.query('senderAddress');

  if (isNaN(settlementId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid settlement ID' }, 400);
  }

  if (!senderAddress) {
    return c.json({ error: 'missing_param', detail: 'senderAddress query param required' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUser.id) {
    return c.json(
      { error: 'not_debtor', detail: 'Only the debtor can get transaction params' },
      403,
    );
  }

  if (settlement.status !== 'open') {
    return c.json(
      { error: 'invalid_status', detail: `Settlement is ${settlement.status}, expected open` },
      400,
    );
  }

  const contractAddress = c.env.SETTLEMENT_CONTRACT_ADDRESS;
  const usdtMasterAddress = c.env.USDT_MASTER_ADDRESS;
  if (!contractAddress || !usdtMasterAddress) {
    return c.json({ error: 'config_error', detail: 'Settlement contract not configured' }, 500);
  }

  // Get creditor's wallet address
  const [creditor] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, settlement.toUser))
    .limit(1);

  if (!creditor?.walletAddress) {
    return c.json({ error: 'no_wallet', detail: 'Creditor has not connected a wallet' }, 400);
  }

  // Look up sender's USDT Jetton Wallet via TONAPI
  const baseUrl = tonapiBaseUrl(c.env);
  let senderJettonWallet: string | null = null;
  try {
    const resp = await fetch(`${baseUrl}/v2/accounts/${senderAddress}/jettons?currencies=usd`, {
      headers: tonapiHeaders(c.env),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const entry = data.balances?.find(
        (b: any) =>
          b.jetton?.address === usdtMasterAddress ||
          b.jetton?.address?.toLowerCase().includes(usdtMasterAddress.toLowerCase().slice(0, 20)),
      );
      if (entry?.wallet_address) {
        senderJettonWallet = entry.wallet_address.address ?? entry.wallet_address;
      }
    }
  } catch {
    // TONAPI unavailable — frontend can't proceed but we return what we have
  }

  if (!senderJettonWallet) {
    return c.json(
      {
        error: 'no_usdt_wallet',
        detail: 'Could not find your USDT wallet. Make sure you have USDT in your wallet.',
      },
      400,
    );
  }

  return c.json({
    settlementId: settlement.id,
    amount: settlement.amount, // micro-USDT
    recipientAddress: creditor.walletAddress,
    contractAddress,
    senderJettonWallet,
    usdtMasterAddress,
    gasAttach: '500000000', // 0.5 TON
    forwardTonAmount: '400000000', // 0.4 TON
  });
});

// --- Verify settlement on-chain ---
const verifySchema = z.object({
  boc: z.string().optional(),
});

settlementsApp.post('/settlements/:id/verify', zValidator('json', verifySchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const settlementId = parseInt(c.req.param('id'), 10);
  const { boc } = c.req.valid('json');

  if (isNaN(settlementId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid settlement ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUser.id) {
    return c.json({ error: 'not_debtor', detail: 'Only the debtor can verify payment' }, 403);
  }

  if (settlement.status !== 'open' && settlement.status !== 'payment_pending') {
    return c.json(
      { error: 'invalid_status', detail: `Settlement is already ${settlement.status}` },
      400,
    );
  }

  // Mark as payment_pending
  await db
    .update(settlements)
    .set({ status: 'payment_pending', updatedAt: new Date().toISOString() })
    .where(eq(settlements.id, settlementId));

  // If we have a BOC, try to broadcast it (best-effort, TON Connect usually broadcasts itself)
  if (boc) {
    const baseUrl = tonapiBaseUrl(c.env);
    try {
      await fetch(`${baseUrl}/v2/blockchain/message`, {
        method: 'POST',
        headers: {
          ...tonapiHeaders(c.env),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ boc }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // TON Connect already broadcast it, this is just a backup
    }
  }

  return c.json({
    status: 'payment_pending',
    detail: 'Transaction submitted, awaiting on-chain confirmation.',
    settlementId,
  });
});

// --- Mark as settled externally (either party) ---
const markExternalSchema = z.object({
  comment: z.string().max(500).optional(),
  amount: z.number().int().positive().optional(),
});

settlementsApp.post(
  '/settlements/:id/mark-external',
  zValidator('json', markExternalSchema),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const settlementId = parseInt(c.req.param('id'), 10);
    const { comment, amount: customAmount } = c.req.valid('json');

    if (isNaN(settlementId)) {
      return c.json({ error: 'invalid_id', detail: 'Invalid settlement ID' }, 400);
    }

    const [currentUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, session.telegramId))
      .limit(1);

    if (!currentUser) {
      return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
    }

    const [settlement] = await db
      .select()
      .from(settlements)
      .where(eq(settlements.id, settlementId))
      .limit(1);

    if (!settlement) {
      return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
    }

    // Either debtor or creditor can mark as settled
    if (settlement.fromUser !== currentUser.id && settlement.toUser !== currentUser.id) {
      return c.json(
        { error: 'not_involved', detail: 'You are not involved in this settlement' },
        403,
      );
    }

    if (settlement.status !== 'open' && settlement.status !== 'payment_pending') {
      return c.json(
        { error: 'invalid_status', detail: `Settlement is already ${settlement.status}` },
        400,
      );
    }

    const paidAmount = customAmount ?? settlement.amount;

    await db
      .update(settlements)
      .set({
        status: 'settled_external',
        amount: paidAmount,
        comment: comment ?? null,
        settledBy: currentUser.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(settlements.id, settlementId));

    // Log activity
    await logActivity(db, {
      groupId: settlement.groupId,
      actorId: currentUser.id,
      type: 'settlement_completed',
      settlementId,
      targetUserId:
        currentUser.id === settlement.fromUser ? settlement.toUser : settlement.fromUser,
      amount: paidAmount,
    });

    // Fire-and-forget notification
    const notifyCtx = {
      botToken: c.env.TELEGRAM_BOT_TOKEN,
      pagesUrl: c.env.PAGES_URL || '',
      onBotBlocked: (telegramId: number) => {
        db.update(users)
          .set({ botStarted: false })
          .where(eq(users.telegramId, telegramId))
          .catch(() => {});
      },
    };
    c.executionCtx.waitUntil(
      sendSettlementNotification(
        notifyCtx,
        db,
        { id: settlementId, amount: paidAmount, status: 'settled_external', txHash: null },
        settlement.fromUser,
        settlement.toUser,
        settlement.groupId,
      ),
    );

    return c.json({ status: 'settled_external', settlementId });
  },
);

// --- Upload receipt for settlement ---
settlementsApp.post('/settlements/:id/receipt', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const settlementId = parseInt(c.req.param('id'), 10);

  if (isNaN(settlementId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid settlement ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUser.id && settlement.toUser !== currentUser.id) {
    return c.json(
      { error: 'not_involved', detail: 'You are not involved in this settlement' },
      403,
    );
  }

  const body = await c.req.parseBody();
  const receipt = body['receipt'];
  const thumbnail = body['thumbnail'];

  if (!(receipt instanceof File)) {
    return c.json({ error: 'missing_file', detail: 'No receipt file provided' }, 400);
  }

  const validationError = validateUpload(receipt);
  if (validationError) {
    return c.json({ error: 'invalid_file', detail: validationError }, 400);
  }

  const receiptKey = generateR2Key('receipts', settlementId);
  await c.env.IMAGES.put(receiptKey, await receipt.arrayBuffer(), {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  let thumbKey: string | null = null;
  if (thumbnail instanceof File) {
    thumbKey = receiptKey.replace('.jpg', '-thumb.jpg');
    await c.env.IMAGES.put(thumbKey, await thumbnail.arrayBuffer(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
  }

  // Delete old receipt from R2 (best-effort)
  if (settlement.receiptKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, settlement.receiptKey));
  }
  if (settlement.receiptThumbKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, settlement.receiptThumbKey));
  }

  await db
    .update(settlements)
    .set({ receiptKey, receiptThumbKey: thumbKey })
    .where(eq(settlements.id, settlementId));

  return c.json({ receiptKey, receiptThumbKey: thumbKey });
});

// --- Delete receipt from settlement ---
settlementsApp.delete('/settlements/:id/receipt', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const settlementId = parseInt(c.req.param('id'), 10);

  if (isNaN(settlementId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid settlement ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUser.id && settlement.toUser !== currentUser.id) {
    return c.json(
      { error: 'not_involved', detail: 'You are not involved in this settlement' },
      403,
    );
  }

  if (settlement.receiptKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, settlement.receiptKey));
  }
  if (settlement.receiptThumbKey) {
    c.executionCtx.waitUntil(safeR2Delete(c.env.IMAGES, settlement.receiptThumbKey));
  }

  await db
    .update(settlements)
    .set({ receiptKey: null, receiptThumbKey: null })
    .where(eq(settlements.id, settlementId));

  return c.json({ deleted: true });
});

// --- Settlement notification helper ---
async function sendSettlementNotification(
  notifyCtx: { botToken: string; pagesUrl: string; onBotBlocked?: (telegramId: number) => void },
  db: Database,
  settlement: { id: number; amount: number; status: string; txHash?: string | null },
  fromUserId: number,
  toUserId: number,
  groupId: number,
): Promise<void> {
  try {
    const [[debtor], [creditor], [group]] = await Promise.all([
      db
        .select({
          telegramId: users.telegramId,
          displayName: users.displayName,
          botStarted: users.botStarted,
        })
        .from(users)
        .where(eq(users.id, fromUserId))
        .limit(1),
      db
        .select({
          telegramId: users.telegramId,
          displayName: users.displayName,
          botStarted: users.botStarted,
        })
        .from(users)
        .where(eq(users.id, toUserId))
        .limit(1),
      db
        .select({ name: groups.name, currency: groups.currency })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1),
    ]);

    await notify.settlementCompleted(
      notifyCtx,
      { ...settlement, groupId },
      debtor,
      creditor,
      group.name,
      group.currency,
    );
  } catch (e) {
    console.error('Notification failed (settlement_completed):', e);
  }
}

// --- TONAPI helpers ---

function tonapiBaseUrl(env: Env): string {
  return env.TON_NETWORK === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io';
}

function tonapiHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.TONAPI_KEY) {
    headers['Authorization'] = `Bearer ${env.TONAPI_KEY}`;
  }
  return headers;
}

/**
 * Verify a settlement on-chain by checking the contract's recent events.
 * Looks for a Jetton transfer TO the contract matching the settlement amount,
 * with an outgoing transfer to the creditor's wallet.
 */
async function verifySettlementOnChain(
  env: Env,
  settlement: { id: number; amount: number; toUser: number },
  creditorWallet: string,
): Promise<{ verified: boolean; txHash?: string }> {
  const contractAddress = env.SETTLEMENT_CONTRACT_ADDRESS;
  if (!contractAddress) return { verified: false };

  const baseUrl = tonapiBaseUrl(env);
  try {
    const resp = await fetch(`${baseUrl}/v2/accounts/${contractAddress}/events?limit=20`, {
      headers: tonapiHeaders(env),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { verified: false };

    const data = (await resp.json()) as any;
    const events = data.events ?? [];

    for (const event of events) {
      if (!event.actions) continue;

      // Look for JettonTransfer actions in this event
      const jettonActions = event.actions.filter(
        (a: any) => a.type === 'JettonTransfer' && a.status === 'ok',
      );

      // Find an outgoing transfer from the contract to the creditor with matching amount
      const matchingTransfer = jettonActions.find((a: any) => {
        const transfer = a.JettonTransfer;
        if (!transfer) return false;

        // Check recipient matches creditor (compare raw addresses)
        const recipientAddr = transfer.recipient?.address ?? '';
        const creditorNorm = creditorWallet.replace(/^0:/, '').toLowerCase();
        const recipientNorm = recipientAddr.replace(/^0:/, '').toLowerCase();

        if (!recipientNorm.includes(creditorNorm) && !creditorNorm.includes(recipientNorm)) {
          return false;
        }

        // Check amount: the recipient gets (amount - commission)
        // Commission is 1% clamped [0.1, 1.0] USDT
        const rawCommission = Math.floor(settlement.amount / 100);
        const commission = Math.max(100_000, Math.min(1_000_000, rawCommission)); // micro-USDT
        const expectedRecipientAmount = settlement.amount - commission;

        const transferAmount = parseInt(transfer.amount ?? '0', 10);
        // Allow 1% tolerance for rounding
        const tolerance = Math.max(1, Math.floor(expectedRecipientAmount * 0.01));
        return Math.abs(transferAmount - expectedRecipientAmount) <= tolerance;
      });

      if (matchingTransfer) {
        return { verified: true, txHash: event.event_id };
      }
    }
  } catch {
    // TONAPI error — can't verify yet
  }

  return { verified: false };
}

export { settlementsApp };
