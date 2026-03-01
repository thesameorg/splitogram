import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { settlements, groupMembers, users, groups } from '../db/schema';
import { simplifyDebts } from '../services/debt-solver';
import { computeGroupBalances } from './balances';
import { notify } from '../services/notifications';
import { logActivity } from '../services/activity';
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

  return c.json({
    ...settlement,
    currentUserId: currentUser.id,
    currency: group?.currency ?? 'USD',
    from: { userId: settlement.fromUser, ...fromUserInfo },
    to: { userId: settlement.toUser, ...toUserInfo },
  });
});

// --- Get transaction params for settlement ---
settlementsApp.get('/settlements/:id/tx', async (c) => {
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

  // Get creditor's wallet address
  const [creditor] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, settlement.toUser))
    .limit(1);

  if (!creditor?.walletAddress) {
    return c.json({ error: 'no_wallet', detail: 'Creditor has not connected a wallet' }, 400);
  }

  const usdtMasterAddress = c.env.USDT_MASTER_ADDRESS;
  if (!usdtMasterAddress) {
    return c.json({ error: 'config_error', detail: 'USDT contract not configured' }, 500);
  }

  return c.json({
    settlementId: settlement.id,
    amount: settlement.amount, // micro-USDT
    recipientAddress: creditor.walletAddress,
    usdtMasterAddress,
    comment: `splitogram:${settlement.id}`,
  });
});

// --- Verify settlement on-chain ---
const verifySchema = z
  .object({
    boc: z.string().optional(),
    txHash: z.string().optional(),
  })
  .refine((d) => d.boc || d.txHash, { message: 'Either boc or txHash is required' });

settlementsApp.post('/settlements/:id/verify', zValidator('json', verifySchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const settlementId = parseInt(c.req.param('id'), 10);
  const { boc, txHash } = c.req.valid('json');

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

  // Mark as payment_pending while we verify
  await db
    .update(settlements)
    .set({ status: 'payment_pending', updatedAt: new Date().toISOString() })
    .where(eq(settlements.id, settlementId));

  // Try to verify via TONAPI
  const tonapiKey = c.env.TONAPI_KEY;
  if (!tonapiKey) {
    // No TONAPI key — can't verify, stay pending
    return c.json({
      status: 'payment_pending',
      detail: 'Transaction submitted, awaiting verification',
      settlementId,
    });
  }

  // If we have a BOC, send it to TONAPI to get tx hash
  let resolvedTxHash = txHash;
  if (boc && !resolvedTxHash) {
    try {
      const sendResp = await fetch('https://testnet.tonapi.io/v2/blockchain/message', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tonapiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ boc }),
        signal: AbortSignal.timeout(10000),
      });

      if (sendResp.ok) {
        // BOC sent — need to poll for confirmation
        return c.json({
          status: 'payment_pending',
          detail:
            'Transaction broadcast, awaiting on-chain confirmation. Poll GET /settlements/:id for status.',
          settlementId,
        });
      }
    } catch {
      // Timeout or network error — stay pending
    }

    return c.json({
      status: 'payment_pending',
      detail: 'Transaction submitted, awaiting verification',
      settlementId,
    });
  }

  // If we have a tx hash, verify it
  if (resolvedTxHash) {
    try {
      const verified = await verifyTransaction(c.env, settlement, resolvedTxHash);

      if (verified) {
        await db
          .update(settlements)
          .set({
            status: 'settled_onchain',
            txHash: resolvedTxHash,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(settlements.id, settlementId));

        // Fire-and-forget notification
        const onchainNotifyCtx = {
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
            onchainNotifyCtx,
            db,
            {
              id: settlementId,
              amount: settlement.amount,
              status: 'settled_onchain',
              txHash: resolvedTxHash,
            },
            settlement.fromUser,
            settlement.toUser,
            settlement.groupId,
          ),
        );

        return c.json({ status: 'settled_onchain', txHash: resolvedTxHash, settlementId });
      }
    } catch {
      // Verification failed — stay pending
    }
  }

  return c.json({
    status: 'payment_pending',
    detail: 'Transaction not yet confirmed. Try again or use "Refresh status".',
    settlementId,
  });
});

// --- Mark as settled externally (either party) ---
const markExternalSchema = z.object({
  comment: z.string().max(500).optional(),
});

settlementsApp.post(
  '/settlements/:id/mark-external',
  zValidator('json', markExternalSchema),
  async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const settlementId = parseInt(c.req.param('id'), 10);
    const { comment } = c.req.valid('json');

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

    await db
      .update(settlements)
      .set({
        status: 'settled_external',
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
      amount: settlement.amount,
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
        { id: settlementId, amount: settlement.amount, status: 'settled_external', txHash: null },
        settlement.fromUser,
        settlement.toUser,
        settlement.groupId,
      ),
    );

    return c.json({ status: 'settled_external', settlementId });
  },
);

// --- Wallet endpoint ---
const walletSchema = z.object({
  address: z.string().min(1),
});

settlementsApp.put('/users/me/wallet', zValidator('json', walletSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { address } = c.req.valid('json');

  await db
    .update(users)
    .set({ walletAddress: address, updatedAt: new Date().toISOString() })
    .where(eq(users.telegramId, session.telegramId));

  return c.json({ walletAddress: address });
});

settlementsApp.delete('/users/me/wallet', async (c) => {
  const db = c.get('db');
  const session = c.get('session');

  await db
    .update(users)
    .set({ walletAddress: null, updatedAt: new Date().toISOString() })
    .where(eq(users.telegramId, session.telegramId));

  return c.json({ walletAddress: null });
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

// --- TONAPI verification helper ---
// SECURITY GATE: This is a STUB. Do NOT enable Phase 3 crypto settlement until this
// function fully verifies: sender wallet, recipient wallet, amount, Jetton contract
// address (USDT_MASTER_ADDRESS), and memo (splitogram:{settlementId}).
// Currently it only checks that the tx hash exists on-chain — anyone can submit any
// legitimate tx hash to mark a settlement as paid.
async function verifyTransaction(
  env: Env,
  settlement: { id: number; fromUser: number; toUser: number; amount: number },
  txHash: string,
): Promise<boolean> {
  const tonapiKey = env.TONAPI_KEY;
  if (!tonapiKey) return false;

  const resp = await fetch(`https://testnet.tonapi.io/v2/blockchain/transactions/${txHash}`, {
    headers: { Authorization: `Bearer ${tonapiKey}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) return false;

  const tx = (await resp.json()) as any;

  return tx && tx.hash === txHash;
}

export { settlementsApp };
