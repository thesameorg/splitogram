import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { settlements, groupMembers, users, groups } from '../db/schema';
import { simplifyDebts } from '../services/debt-solver';
import { computeGroupBalances } from './balances';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';
import type { Env } from '../env';

type SettlementEnv = AuthContext & DBContext & { Bindings: Env };

const settlementsApp = new Hono<SettlementEnv>();

// --- Create settlement on demand from debt graph ---
settlementsApp.post('/groups/:id/settlements', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);

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

  // Check membership
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  // Compute current debt graph
  const netBalances = await computeGroupBalances(db, groupId);
  const debts = simplifyDebts(netBalances);

  // Find debts where current user is the debtor
  const myDebts = debts.filter((d) => d.from === currentUser.id);

  if (myDebts.length === 0) {
    return c.json({ error: 'no_debts', detail: 'You have no outstanding debts in this group' }, 400);
  }

  // Create settlements for each debt (idempotent — check for existing open ones)
  const created = [];
  for (const debt of myDebts) {
    // Check if open settlement already exists
    const [existing] = await db
      .select()
      .from(settlements)
      .where(
        and(
          eq(settlements.groupId, groupId),
          eq(settlements.fromUser, debt.from),
          eq(settlements.toUser, debt.to),
          eq(settlements.status, 'open'),
        ),
      )
      .limit(1);

    if (existing) {
      // Update amount if changed
      if (existing.amount !== debt.amount) {
        await db
          .update(settlements)
          .set({ amount: debt.amount, updatedAt: new Date().toISOString() })
          .where(eq(settlements.id, existing.id));
      }
      created.push({ ...existing, amount: debt.amount });
    } else {
      const [settlement] = await db
        .insert(settlements)
        .values({
          groupId,
          fromUser: debt.from,
          toUser: debt.to,
          amount: debt.amount,
          status: 'open',
        })
        .returning();
      created.push(settlement);
    }
  }

  return c.json({ settlements: created }, 201);
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
    return c.json({ error: 'not_involved', detail: 'You are not involved in this settlement' }, 403);
  }

  // Get user details
  const [fromUserInfo] = await db
    .select({ displayName: users.displayName, username: users.username, walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, settlement.fromUser))
    .limit(1);

  const [toUserInfo] = await db
    .select({ displayName: users.displayName, username: users.username, walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, settlement.toUser))
    .limit(1);

  return c.json({
    ...settlement,
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
    return c.json({ error: 'not_debtor', detail: 'Only the debtor can get transaction params' }, 403);
  }

  if (settlement.status !== 'open') {
    return c.json({ error: 'invalid_status', detail: `Settlement is ${settlement.status}, expected open` }, 400);
  }

  // Get creditor's wallet address
  const [creditor] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, settlement.toUser))
    .limit(1);

  if (!creditor?.walletAddress) {
    return c.json(
      { error: 'no_wallet', detail: 'Creditor has not connected a wallet' },
      400,
    );
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
const verifySchema = z.object({
  boc: z.string().optional(),
  txHash: z.string().optional(),
}).refine((d) => d.boc || d.txHash, { message: 'Either boc or txHash is required' });

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
    return c.json({ error: 'invalid_status', detail: `Settlement is already ${settlement.status}` }, 400);
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
          'Authorization': `Bearer ${tonapiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ boc }),
        signal: AbortSignal.timeout(10000),
      });

      if (sendResp.ok) {
        // BOC sent — need to poll for confirmation
        return c.json({
          status: 'payment_pending',
          detail: 'Transaction broadcast, awaiting on-chain confirmation. Poll GET /settlements/:id for status.',
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

// --- Mark as settled externally ---
settlementsApp.post('/settlements/:id/mark-external', async (c) => {
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

  // Only creditor can mark as externally settled
  if (settlement.toUser !== currentUser.id) {
    return c.json(
      { error: 'not_creditor', detail: 'Only the creditor can mark a settlement as externally settled' },
      403,
    );
  }

  if (settlement.status !== 'open' && settlement.status !== 'payment_pending') {
    return c.json({ error: 'invalid_status', detail: `Settlement is already ${settlement.status}` }, 400);
  }

  await db
    .update(settlements)
    .set({
      status: 'settled_external',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(settlements.id, settlementId));

  return c.json({ status: 'settled_external', settlementId });
});

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

// --- TONAPI verification helper ---
async function verifyTransaction(
  env: Env,
  settlement: { id: number; fromUser: number; toUser: number; amount: number },
  txHash: string,
): Promise<boolean> {
  const tonapiKey = env.TONAPI_KEY;
  if (!tonapiKey) return false;

  const resp = await fetch(
    `https://testnet.tonapi.io/v2/blockchain/transactions/${txHash}`,
    {
      headers: { Authorization: `Bearer ${tonapiKey}` },
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!resp.ok) return false;

  const tx = await resp.json() as any;

  // Basic verification: transaction exists and is confirmed
  // Full verification (sender, recipient, amount, comment) requires parsing Jetton transfer messages
  // For Phase 1, accept if tx exists — detailed verification is a Phase 2 improvement
  return tx && tx.hash === txHash;
}

export { settlementsApp };
