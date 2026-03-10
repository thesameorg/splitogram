import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { settlements, groupMembers, users, groups } from '../db/schema';
import { simplifyDebts } from '../services/debt-solver';
import { computeGroupBalances, refreshGroupBalances } from './balances';
import { notify } from '../services/notifications';
import { logActivity } from '../services/activity';
import { generateR2Key, safeR2Delete, validateUpload } from '../utils/r2';
import { getExchangeRates, convertToMicroUsdt } from '../services/exchange-rates';
import type { Database } from '../db';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';
import type { Env } from '../env';

function tonExplorerUrl(env: Env, txHash: string): string {
  const base =
    env.TON_NETWORK === 'mainnet' ? 'https://tonviewer.com' : 'https://testnet.tonviewer.com';
  return `${base}/transaction/${txHash}`;
}

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

    const currentUserId = session.userId;

    // Current user must be one of the parties
    if (currentUserId !== fromUserId && currentUserId !== toUserId) {
      return c.json({ error: 'not_involved', detail: 'You must be the debtor or creditor' }, 403);
    }

    // Check membership
    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUserId)))
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
  const currentUserId = session.userId;

  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUserId)))
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
    txHash: r.txHash,
    explorerUrl: r.txHash ? tonExplorerUrl(c.env, r.txHash) : null,
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

  const currentUserId = session.userId;

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  // Check user is involved (debtor or creditor)
  if (settlement.fromUser !== currentUserId && settlement.toUser !== currentUserId) {
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
    currentUserId: currentUserId,
    currency: group?.currency ?? 'USD',
    explorerUrl: settlement.txHash ? tonExplorerUrl(c.env, settlement.txHash) : null,
    from: { userId: settlement.fromUser, ...fromUserInfo },
    to: { userId: settlement.toUser, ...toUserInfo },
  };

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

  const currentUserId = session.userId;

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUserId) {
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

  // Get group currency for conversion
  const [group] = await db
    .select({ currency: groups.currency })
    .from(groups)
    .where(eq(groups.id, settlement.groupId))
    .limit(1);

  const groupCurrency = group?.currency ?? 'USD';

  // Convert group currency amount to USDT (micro-units)
  let settlementAmountUsdt = settlement.amount; // default: same as group amount (USD groups)
  if (groupCurrency !== 'USD') {
    const ratesData = await getExchangeRates(c.env.KV);
    if (!ratesData) {
      return c.json(
        { error: 'rates_unavailable', detail: 'Exchange rates unavailable. Try again later.' },
        503,
      );
    }
    const converted = convertToMicroUsdt(settlement.amount, groupCurrency, ratesData.rates);
    if (converted === null) {
      return c.json(
        { error: 'unsupported_currency', detail: `Cannot convert ${groupCurrency} to USDT` },
        400,
      );
    }
    settlementAmountUsdt = converted;
  }

  // Look up sender's USDT Jetton Wallet via TONAPI
  const baseUrl = tonapiBaseUrl(c.env);
  const usdtMasterRaw = friendlyToRaw(usdtMasterAddress);
  let senderJettonWallet: string | null = null;
  let senderUsdtBalance: number | null = null;
  try {
    const resp = await fetch(`${baseUrl}/v2/accounts/${senderAddress}/jettons?currencies=usd`, {
      headers: tonapiHeaders(c.env),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const entry = data.balances?.find((b: any) => {
        const addr = b.jetton?.address;
        if (!addr) return false;
        // TONAPI returns raw format (0:hex), config may be friendly (base64url)
        return (
          addr === usdtMasterAddress ||
          addr === usdtMasterRaw ||
          (usdtMasterRaw && addr.toLowerCase() === usdtMasterRaw.toLowerCase())
        );
      });
      if (entry?.wallet_address) {
        senderJettonWallet = entry.wallet_address.address ?? entry.wallet_address;
      }
      if (entry?.balance != null) {
        senderUsdtBalance = parseInt(entry.balance, 10);
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

  // Calculate commission so payer sends debt + commission (recipient gets full debt)
  const commission = calculateCommission(settlementAmountUsdt);
  const totalAmount = settlementAmountUsdt + commission;

  // Check USDT balance if available (TONAPI returns balance in nano-units, USDT has 6 decimals)
  if (senderUsdtBalance != null && senderUsdtBalance < totalAmount) {
    return c.json(
      {
        error: 'insufficient_usdt',
        detail: 'Not enough USDT to cover payment + commission.',
        balance: senderUsdtBalance,
        required: totalAmount,
      },
      400,
    );
  }

  const network = c.env.TON_NETWORK === 'mainnet' ? '-239' : '-3'; // CHAIN enum values

  // Dynamic gas calculation based on testnet profiling:
  // Settlement chain = 11 messages, measured cost ~0.035 TON.
  // forward_ton_amount needs to cover contract's 2 outgoing Jetton transfers (0.15 TON each).
  // Add 0.1 TON contingency and round up to nearest 0.1 TON.
  const BASE_FORWARD_TON = 300_000_000; // 0.3 TON (2x 0.15 for outgoing transfers)
  const GAS_OVERHEAD = 50_000_000; // 0.05 TON (contract execution + bounce handling)
  const CONTINGENCY = 100_000_000; // 0.1 TON safety margin
  const forwardTon = BASE_FORWARD_TON + GAS_OVERHEAD;
  const gasAttach = forwardTon + CONTINGENCY;
  // Round up to nearest 0.1 TON
  const gasAttachRounded = Math.ceil(gasAttach / 100_000_000) * 100_000_000;

  return c.json({
    settlementId: settlement.id,
    amount: settlementAmountUsdt, // micro-USDT (debt converted to USD)
    totalAmount, // micro-USDT (debt + commission — what payer sends)
    commission, // micro-USDT
    originalAmount: settlement.amount, // micro-units in group currency
    originalCurrency: groupCurrency,
    recipientAddress: creditor.walletAddress,
    contractAddress,
    senderAddress,
    senderJettonWallet,
    usdtMasterAddress,
    gasAttach: String(gasAttachRounded), // nanoTON, dynamically calculated
    forwardTonAmount: String(forwardTon), // nanoTON
    network, // "-3" testnet, "-239" mainnet
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

  const currentUserId = session.userId;

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUserId) {
    return c.json({ error: 'not_debtor', detail: 'Only the debtor can verify payment' }, 403);
  }

  if (settlement.status !== 'open' && settlement.status !== 'payment_pending') {
    return c.json(
      { error: 'invalid_status', detail: `Settlement is already ${settlement.status}` },
      400,
    );
  }

  // Atomic conditional update — only transition from 'open' to 'payment_pending'
  if (settlement.status === 'open') {
    const updated = await db
      .update(settlements)
      .set({ status: 'payment_pending', updatedAt: new Date().toISOString() })
      .where(and(eq(settlements.id, settlementId), eq(settlements.status, 'open')))
      .returning({ id: settlements.id });

    if (updated.length === 0) {
      return c.json({ error: 'invalid_status', detail: 'Settlement status has changed' }, 409);
    }
  }

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

// --- Confirm on-chain settlement (poll endpoint) ---
const confirmSchema = z.object({
  txHash: z.string().max(200).optional(),
});

settlementsApp.post('/settlements/:id/confirm', zValidator('json', confirmSchema, (result, c) => {
  // Allow empty body (polling without txHash)
  if (!result.success) {
    return c.json({ error: 'invalid_input', detail: 'Invalid request body' }, 400);
  }
}), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const settlementId = parseInt(c.req.param('id'), 10);

  if (isNaN(settlementId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid settlement ID' }, 400);
  }

  const body = c.req.valid('json');
  const userTxHash = body?.txHash ? parseTxHash(body.txHash) : undefined;
  const currentUserId = session.userId;

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUserId && settlement.toUser !== currentUserId) {
    return c.json(
      { error: 'not_involved', detail: 'You are not involved in this settlement' },
      403,
    );
  }

  // Already settled — return current status
  if (settlement.status === 'settled_onchain' || settlement.status === 'settled_external') {
    return c.json({ status: settlement.status, settlementId });
  }

  // Only check on-chain for payment_pending
  if (settlement.status !== 'payment_pending') {
    return c.json({ status: settlement.status, settlementId });
  }

  // Get debtor and creditor wallet addresses for verification
  const [[debtorInfo], [creditorInfo], [group]] = await Promise.all([
    db
      .select({ walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.id, settlement.fromUser))
      .limit(1),
    db
      .select({ walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.id, settlement.toUser))
      .limit(1),
    db
      .select({ currency: groups.currency })
      .from(groups)
      .where(eq(groups.id, settlement.groupId))
      .limit(1),
  ]);

  if (!creditorInfo?.walletAddress) {
    return c.json({ status: 'payment_pending', settlementId });
  }

  // Convert to USDT for on-chain verification if needed
  const groupCurrency = group?.currency ?? 'USD';
  let verifyUsdtAmount: number | undefined;
  if (groupCurrency !== 'USD') {
    const ratesData = await getExchangeRates(c.env.KV);
    if (ratesData) {
      verifyUsdtAmount =
        convertToMicroUsdt(settlement.amount, groupCurrency, ratesData.rates) ?? undefined;
    }
  }

  const debtUsdt = verifyUsdtAmount ?? settlement.amount;

  // Try to verify on-chain (use user-provided txHash if available)
  const verification = userTxHash
    ? await verifyByEventId(
        c.env,
        userTxHash,
        debtorInfo?.walletAddress ?? null,
        creditorInfo.walletAddress,
        debtUsdt,
      )
    : await verifySettlementOnChain(
        c.env,
        settlement,
        debtorInfo?.walletAddress ?? null,
        creditorInfo.walletAddress,
        verifyUsdtAmount,
      );

  if (!verification.verified) {
    // Only rollback to open after timeout AND failed on-chain check
    const pendingSince = new Date(settlement.updatedAt).getTime();
    const PENDING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    if (Date.now() - pendingSince > PENDING_TIMEOUT_MS) {
      await db
        .update(settlements)
        .set({ status: 'open', updatedAt: new Date().toISOString() })
        .where(and(eq(settlements.id, settlementId), eq(settlements.status, 'payment_pending')));
      return c.json({ status: 'open', settlementId });
    }
    return c.json({ status: 'payment_pending', settlementId });
  }

  const settledCommission = calculateCommission(debtUsdt);
  // Atomic conditional update — only settle if still payment_pending
  const confirmed = await db
    .update(settlements)
    .set({
      status: 'settled_onchain',
      txHash: verification.txHash ?? null,
      usdtAmount: debtUsdt,
      commission: settledCommission,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(settlements.id, settlementId), eq(settlements.status, 'payment_pending')))
    .returning({ id: settlements.id });

  if (confirmed.length === 0) {
    // Already settled by another request — return current status
    const [current] = await db
      .select({ status: settlements.status })
      .from(settlements)
      .where(eq(settlements.id, settlementId))
      .limit(1);
    return c.json({ status: current?.status ?? 'unknown', settlementId });
  }

  // Refresh cached balances
  await refreshGroupBalances(db, settlement.groupId);

  // Fire-and-forget notification + activity log
  const explorerUrl = verification.txHash ? tonExplorerUrl(c.env, verification.txHash) : undefined;
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
          explorerUrl,
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
        metadata: verification.txHash
          ? { txHash: verification.txHash, explorerUrl, method: 'onchain' }
          : undefined,
      }),
    ]),
  );

  return c.json({ status: 'settled_onchain', settlementId, txHash: verification.txHash });
});

// --- Mark as settled externally (either party) ---
// Max amount: 10 million units (10,000,000 * 1,000,000 micro-units = 10 trillion)
// This prevents overflow in downstream calculations while allowing any realistic payment
const MAX_AMOUNT_MICRO = 10_000_000_000_000;

const markExternalSchema = z.object({
  comment: z.string().max(500).optional(),
  amount: z.number().int().positive().max(MAX_AMOUNT_MICRO).optional(),
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

    const currentUserId = session.userId;

    const [settlement] = await db
      .select()
      .from(settlements)
      .where(eq(settlements.id, settlementId))
      .limit(1);

    if (!settlement) {
      return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
    }

    // Either debtor or creditor can mark as settled
    if (settlement.fromUser !== currentUserId && settlement.toUser !== currentUserId) {
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

    // Atomic conditional update — prevents race where two users mark simultaneously
    const updated = await db
      .update(settlements)
      .set({
        status: 'settled_external',
        amount: paidAmount,
        comment: comment ?? null,
        settledBy: currentUserId,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(settlements.id, settlementId),
          sql`${settlements.status} IN ('open', 'payment_pending')`,
        ),
      )
      .returning({ id: settlements.id });

    if (updated.length === 0) {
      return c.json({ error: 'already_settled', detail: 'Settlement was already completed' }, 409);
    }

    // Refresh cached balances
    await refreshGroupBalances(db, settlement.groupId);

    // Log activity
    await logActivity(db, {
      groupId: settlement.groupId,
      actorId: currentUserId,
      type: 'settlement_completed',
      settlementId,
      targetUserId: currentUserId === settlement.fromUser ? settlement.toUser : settlement.fromUser,
      amount: paidAmount,
      metadata: { method: 'external' },
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

  const currentUserId = session.userId;

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUserId && settlement.toUser !== currentUserId) {
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

  // Upload thumbnail if provided (validate to prevent oversized uploads)
  let thumbKey: string | null = null;
  if (thumbnail instanceof File) {
    const thumbError = validateUpload(thumbnail);
    if (!thumbError) {
      thumbKey = receiptKey.replace('.jpg', '-thumb.jpg');
      await c.env.IMAGES.put(thumbKey, await thumbnail.arrayBuffer(), {
        httpMetadata: { contentType: 'image/jpeg' },
      });
    }
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

  const currentUserId = session.userId;

  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);

  if (!settlement) {
    return c.json({ error: 'settlement_not_found', detail: 'Settlement not found' }, 404);
  }

  if (settlement.fromUser !== currentUserId && settlement.toUser !== currentUserId) {
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
  settlement: {
    id: number;
    amount: number;
    status: string;
    txHash?: string | null;
    explorerUrl?: string;
  },
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

// --- Commission calculation (mirrors contract: 1% clamped to [0.1, 1.0] USDT) ---

function calculateCommission(microAmount: number): number {
  const raw = Math.floor(microAmount / 100); // 1%
  return Math.max(100_000, Math.min(1_000_000, raw)); // clamp [0.1, 1.0] USDT in micro-units
}

// --- TON address helpers ---

/** Convert a user-friendly TON address (base64/base64url) to raw format (wc:hex) */
function friendlyToRaw(friendly: string): string | null {
  try {
    let b64 = friendly.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.length !== 36) return null; // 1 flag + 1 wc + 32 hash + 2 crc
    const workchain = bytes[1] === 0xff ? -1 : bytes[1];
    const hash = Array.from(bytes.slice(2, 34))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${workchain}:${hash}`;
  } catch {
    return null;
  }
}

/**
 * Parse a tx hash from user input — accepts:
 * - Raw hex hash
 * - Tonviewer URL: https://tonviewer.com/transaction/{hash}
 * - Tonscan URL: https://tonscan.org/tx/{hash}
 * - Tonkeeper redirect URL with encoded tonviewer link
 */
function parseTxHash(input: string): string {
  const trimmed = input.trim();

  // Try to extract from URL patterns
  const tonviewerMatch = trimmed.match(/tonviewer\.com\/transaction\/([a-fA-F0-9]{64})/);
  if (tonviewerMatch) return tonviewerMatch[1];

  const tonscanMatch = trimmed.match(/tonscan\.org\/tx\/([a-fA-F0-9]{64})/);
  if (tonscanMatch) return tonscanMatch[1];

  // URL-encoded tonviewer link (e.g. from Tonkeeper redirect)
  try {
    const decoded = decodeURIComponent(trimmed);
    const decodedMatch = decoded.match(/tonviewer\.com\/transaction\/([a-fA-F0-9]{64})/);
    if (decodedMatch) return decodedMatch[1];
  } catch {
    // not a URL-encoded string
  }

  // Raw hex hash
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;

  return trimmed;
}

/**
 * Verify a settlement by looking up a specific TONAPI event.
 * Used when the user provides a transaction hash/link.
 */
async function verifyByEventId(
  env: Env,
  eventId: string,
  debtorWallet: string | null,
  creditorWallet: string,
  debtUsdt: number,
): Promise<{ verified: boolean; txHash?: string }> {
  const baseUrl = tonapiBaseUrl(env);
  try {
    const resp = await fetch(`${baseUrl}/v2/events/${eventId}`, {
      headers: tonapiHeaders(env),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { verified: false };

    const event = (await resp.json()) as any;
    if (!event.actions) return { verified: false };

    const jettonActions = event.actions.filter(
      (a: any) => a.type === 'JettonTransfer' && a.status === 'ok',
    );

    // Validate debtor if wallet known
    if (debtorWallet) {
      const debtorNorm = normalizeAddress(debtorWallet);
      const hasValidSender = jettonActions.some((a: any) => {
        const transfer = a.JettonTransfer;
        if (!transfer) return false;
        return normalizeAddress(transfer.sender?.address ?? '') === debtorNorm;
      });
      if (!hasValidSender) return { verified: false };
    }

    // Find outgoing transfer to creditor with matching amount
    const creditorNorm = normalizeAddress(creditorWallet);
    const matchingTransfer = jettonActions.find((a: any) => {
      const transfer = a.JettonTransfer;
      if (!transfer) return false;
      const recipientNorm = normalizeAddress(transfer.recipient?.address ?? '');
      if (recipientNorm !== creditorNorm) return false;
      const transferAmount = parseInt(transfer.amount ?? '0', 10);
      const tolerance = Math.max(1, Math.floor(debtUsdt * 0.02));
      return Math.abs(transferAmount - debtUsdt) <= tolerance;
    });

    if (matchingTransfer) {
      return { verified: true, txHash: event.event_id ?? eventId };
    }
  } catch {
    // TONAPI error
  }
  return { verified: false };
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
 * Validates the full trace: sender (debtor) → contract → recipient (creditor),
 * with matching amount. This prevents spoofing by unrelated transfers.
 */
async function verifySettlementOnChain(
  env: Env,
  settlement: { id: number; amount: number; toUser: number },
  debtorWallet: string | null,
  creditorWallet: string,
  usdtAmount?: number, // micro-USDT (if already converted)
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

    const debtUsdt = usdtAmount ?? settlement.amount;

    for (const event of events) {
      if (!event.actions) continue;

      // Look for JettonTransfer actions in this event
      const jettonActions = event.actions.filter(
        (a: any) => a.type === 'JettonTransfer' && a.status === 'ok',
      );

      // We need to find TWO matching transfers in the same event:
      // 1. Incoming: debtor → contract (amount = debt + commission)
      // 2. Outgoing: contract → creditor (amount ≈ debt)
      // Finding the outgoing transfer to creditor with correct amount is sufficient
      // when combined with sender validation on the incoming transfer.

      // Find incoming transfer from debtor to contract
      let hasValidIncoming = false;
      if (debtorWallet) {
        const debtorNorm = normalizeAddress(debtorWallet);
        hasValidIncoming = jettonActions.some((a: any) => {
          const transfer = a.JettonTransfer;
          if (!transfer) return false;
          const senderAddr = normalizeAddress(transfer.sender?.address ?? '');
          // Sender must be the debtor (or debtor's jetton wallet — TONAPI resolves to owner)
          return senderAddr === debtorNorm;
        });
      } else {
        // No debtor wallet on record — can't validate sender, skip sender check
        // This is less secure but allows verification when debtor wallet wasn't stored
        hasValidIncoming = true;
      }

      if (!hasValidIncoming) continue;

      // Find outgoing transfer to creditor with matching amount
      const creditorNorm = normalizeAddress(creditorWallet);
      const matchingTransfer = jettonActions.find((a: any) => {
        const transfer = a.JettonTransfer;
        if (!transfer) return false;

        // Recipient must be the creditor
        const recipientNorm = normalizeAddress(transfer.recipient?.address ?? '');
        if (recipientNorm !== creditorNorm) return false;

        // Amount: creditor receives the debt minus commission rounding
        const transferAmount = parseInt(transfer.amount ?? '0', 10);
        // Allow 2% tolerance for commission calculation differences
        const tolerance = Math.max(1, Math.floor(debtUsdt * 0.02));
        return Math.abs(transferAmount - debtUsdt) <= tolerance;
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

/** Normalize a TON address for comparison (strip 0: prefix, lowercase) */
function normalizeAddress(addr: string): string {
  return addr.replace(/^0:/, '').toLowerCase();
}

export { settlementsApp };
