import { Hono } from 'hono';
import { sql, desc, eq, isNull } from 'drizzle-orm';
import { users, groups, groupMembers, expenses, settlements } from '../db/schema';
import { removeImage } from '../services/moderation';
import { formatAmount } from '../utils/format';
import type { Env } from '../env';
import type { Database } from '../db';

type AdminEnv = { Bindings: Env; Variables: { db: Database } };

const app = new Hono<AdminEnv>();

// Manual Basic Auth — no hono/basic-auth dependency
app.use('*', async (c, next) => {
  const secret = c.env.ADMIN_SECRET;
  if (!secret) {
    return c.text('Admin not configured — set ADMIN_SECRET env var', 403);
  }

  const header = c.req.header('Authorization');
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const colon = decoded.indexOf(':');
      if (colon !== -1) {
        const user = decoded.slice(0, colon);
        const pass = decoded.slice(colon + 1);
        if (user === 'admin' && pass === secret) {
          return next();
        }
      }
    } catch {
      // malformed base64 — fall through to 401
    }
  }

  c.header('WWW-Authenticate', 'Basic realm="Splitogram Admin"');
  return c.text('Unauthorized', 401);
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tonviewerBase(env: Env): string {
  return env.TON_NETWORK === 'mainnet' ? 'https://tonviewer.com' : 'https://testnet.tonviewer.com';
}

function layout(title: string, body: string, env: Env): string {
  const network = env.TON_NETWORK === 'mainnet' ? '' : ' [testnet]';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Splitogram Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 text-gray-900 min-h-screen">
  <nav class="bg-white border-b px-4 py-3 flex items-center justify-between">
    <a href="/admin" class="text-lg font-bold">Splitogram Admin${network ? `<span class="ml-2 text-xs font-normal px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded">${escapeHtml(network.trim())}</span>` : ''}</a>
  </nav>
  <main class="max-w-5xl mx-auto px-4 py-6">${body}</main>
</body>
</html>`;
}

function metricCard(label: string, value: string | number): string {
  return `<div class="bg-white rounded-lg border p-4">
    <div class="text-sm text-gray-500">${escapeHtml(label)}</div>
    <div class="text-2xl font-bold mt-1">${escapeHtml(String(value))}</div>
  </div>`;
}

// --- Dashboard ---
app.get('/', async (c) => {
  const db = c.get('db');

  const [{ total: totalUsers }] = await db.select({ total: sql<number>`count(*)` }).from(users);
  const [{ total: dummyUsers }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.isDummy, true));
  const realUsers = totalUsers - dummyUsers;
  const [{ total: activeGroupCount }] = await db
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ total: activeGroups30d }] = await db
    .select({ total: sql<number>`count(distinct ${expenses.groupId})` })
    .from(expenses)
    .where(sql`${expenses.createdAt} > ${thirtyDaysAgo}`);

  // Groups table with pagination
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const showDeleted = c.req.query('showDeleted') === '1';

  const groupRows = await db
    .select({
      id: groups.id,
      name: groups.name,
      currency: groups.currency,
      createdAt: groups.createdAt,
      deletedAt: groups.deletedAt,
      memberCount: sql<number>`(select count(*) from group_members where group_members.group_id = groups.id)`,
      expenseCount: sql<number>`(select count(*) from expenses where expenses.group_id = groups.id)`,
    })
    .from(groups)
    .where(showDeleted ? undefined : isNull(groups.deletedAt))
    .orderBy(desc(groups.createdAt))
    .limit(perPage)
    .offset(offset);

  const hasMore = groupRows.length === perPage;

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
  const volumeStr = formatAmount(onchainStats.volume, 'USD');
  const feesStr = formatAmount(onchainStats.fees, 'USD');

  // Recent on-chain transactions
  const onchainTxs = await db
    .select({
      id: settlements.id,
      txHash: settlements.txHash,
      usdtAmount: settlements.usdtAmount,
      commission: settlements.commission,
      fromUser: settlements.fromUser,
      toUser: settlements.toUser,
      groupId: settlements.groupId,
      updatedAt: settlements.updatedAt,
    })
    .from(settlements)
    .where(eq(settlements.status, 'settled_onchain'))
    .orderBy(desc(settlements.updatedAt))
    .limit(20);

  // Resolve user names + group names for on-chain txs
  const userIds = new Set<number>();
  const groupIds = new Set<number>();
  for (const tx of onchainTxs) {
    userIds.add(tx.fromUser);
    userIds.add(tx.toUser);
    groupIds.add(tx.groupId);
  }
  const userMap = new Map<number, string>();
  const groupMap = new Map<number, string>();
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(
        sql`${users.id} IN (${sql.join(
          [...userIds].map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    for (const u of userRows) userMap.set(u.id, u.displayName);
  }
  if (groupIds.size > 0) {
    const groupNameRows = await db
      .select({ id: groups.id, name: groups.name, deletedAt: groups.deletedAt })
      .from(groups)
      .where(
        sql`${groups.id} IN (${sql.join(
          [...groupIds].map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    for (const g of groupNameRows) {
      groupMap.set(g.id, g.deletedAt ? `${g.name} (deleted)` : g.name);
    }
  }

  const viewerBase = tonviewerBase(c.env);

  const cards = `
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
      ${metricCard('Users', `${realUsers}${dummyUsers > 0 ? ` (+${dummyUsers} placeholders)` : ''}`)}
      ${metricCard('Groups', `${activeGroupCount}${deletedGroupCount > 0 ? ` (+${deletedGroupCount} deleted)` : ''}`)}
      ${metricCard('Active (30d)', activeGroups30d)}
      ${metricCard('Expenses', expenseCount)}
      ${metricCard('Settlements', settlementCount)}
    </div>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
      ${metricCard('On-chain TXs', onchainCount)}
      ${metricCard('Volume (USDT)', '~' + volumeStr)}
      ${metricCard('Fees Earned', '~' + feesStr)}
    </div>`;

  const tableRows = groupRows
    .map((g) => {
      const deleted = g.deletedAt != null;
      const nameClass = deleted ? 'text-gray-400 line-through' : 'text-blue-600 hover:underline';
      const nameHtml = deleted
        ? `<span class="${nameClass}">${escapeHtml(g.name)}</span> <span class="text-xs text-red-400 ml-1">deleted</span>`
        : `<a href="/admin/groups/${g.id}" class="${nameClass}">${escapeHtml(g.name)}</a>`;
      return `<tr class="border-b hover:bg-gray-50">
      <td class="py-2 px-3">${nameHtml}</td>
      <td class="py-2 px-3 text-center">${g.memberCount}</td>
      <td class="py-2 px-3 text-center">${g.expenseCount}</td>
      <td class="py-2 px-3 text-center">${escapeHtml(g.currency)}</td>
      <td class="py-2 px-3 text-gray-500 text-sm">${g.createdAt.split('T')[0]}</td>
    </tr>`;
    })
    .join('');

  const showDeletedParam = showDeleted ? '&showDeleted=1' : '';
  const toggleUrl = showDeleted ? `/admin?page=1` : `/admin?page=1&showDeleted=1`;

  const pagination = `<div class="flex gap-4 mt-4">
    ${page > 1 ? `<a href="/admin?page=${page - 1}${showDeletedParam}" class="text-blue-600 hover:underline">&larr; Prev</a>` : ''}
    <span class="text-gray-500">Page ${page}</span>
    ${hasMore ? `<a href="/admin?page=${page + 1}${showDeletedParam}" class="text-blue-600 hover:underline">Next &rarr;</a>` : ''}
  </div>`;

  const table = `
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold">Groups</h2>
      <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" ${showDeleted ? 'checked' : ''} onchange="window.location.href='${toggleUrl}'" class="rounded">
        Show deleted (${deletedGroupCount} groups)
      </label>
    </div>
    <div class="bg-white rounded-lg border overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr>
            <th class="py-2 px-3 text-left">Name</th>
            <th class="py-2 px-3 text-center">Members</th>
            <th class="py-2 px-3 text-center">Expenses</th>
            <th class="py-2 px-3 text-center">Currency</th>
            <th class="py-2 px-3 text-left">Created</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${pagination}`;

  // On-chain transactions table
  const txRows = onchainTxs
    .map((tx) => {
      const amount = tx.usdtAmount != null ? formatAmount(tx.usdtAmount, 'USD') : '-';
      const fee = tx.commission != null ? formatAmount(tx.commission, 'USD') : '-';
      const from = userMap.get(tx.fromUser) ?? `#${tx.fromUser}`;
      const to = userMap.get(tx.toUser) ?? `#${tx.toUser}`;
      const group = groupMap.get(tx.groupId) ?? `#${tx.groupId}`;
      const txLink = tx.txHash
        ? `<a href="${viewerBase}/transaction/${escapeHtml(tx.txHash)}" target="_blank" class="text-blue-600 hover:underline font-mono text-xs">${escapeHtml(tx.txHash.slice(0, 10))}...</a>`
        : '-';
      const date = tx.updatedAt.split('T')[0];
      return `<tr class="border-b hover:bg-gray-50">
      <td class="py-2 px-3">${txLink}</td>
      <td class="py-2 px-3">${escapeHtml(from)}</td>
      <td class="py-2 px-3">${escapeHtml(to)}</td>
      <td class="py-2 px-3 text-right">${escapeHtml(amount)}</td>
      <td class="py-2 px-3 text-right">${escapeHtml(fee)}</td>
      <td class="py-2 px-3 text-gray-500">${escapeHtml(group)}</td>
      <td class="py-2 px-3 text-gray-500 text-sm">${date}</td>
    </tr>`;
    })
    .join('');

  const txTable =
    onchainTxs.length > 0
      ? `
    <h2 class="text-lg font-semibold mb-3 mt-8">On-chain Transactions (last 20)</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr>
            <th class="py-2 px-3 text-left">TX Hash</th>
            <th class="py-2 px-3 text-left">From</th>
            <th class="py-2 px-3 text-left">To</th>
            <th class="py-2 px-3 text-right">USDT</th>
            <th class="py-2 px-3 text-right">Fee</th>
            <th class="py-2 px-3 text-left">Group</th>
            <th class="py-2 px-3 text-left">Date</th>
          </tr>
        </thead>
        <tbody>${txRows}</tbody>
      </table>
    </div>`
      : '';

  return c.html(layout('Dashboard', cards + table + txTable, c.env));
});

// --- Group Detail ---
app.get('/groups/:id', async (c) => {
  const db = c.get('db');
  const groupId = parseInt(c.req.param('id'), 10);
  if (isNaN(groupId)) return c.text('Invalid group ID', 400);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return c.text('Group not found', 404);

  const isDeleted = group.deletedAt != null;

  // Members
  const members = await db
    .select({
      userId: groupMembers.userId,
      role: groupMembers.role,
      displayName: users.displayName,
      username: users.username,
      avatarKey: users.avatarKey,
      isDummy: users.isDummy,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  // Recent expenses
  const recentExpenses = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      description: expenses.description,
      paidBy: expenses.paidBy,
      payerName: users.displayName,
      receiptKey: expenses.receiptKey,
      receiptThumbKey: expenses.receiptThumbKey,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(users, eq(expenses.paidBy, users.id))
    .where(eq(expenses.groupId, groupId))
    .orderBy(desc(expenses.createdAt))
    .limit(50);

  // Settlements for this group
  const groupSettlements = await db
    .select({
      id: settlements.id,
      fromUser: settlements.fromUser,
      toUser: settlements.toUser,
      amount: settlements.amount,
      status: settlements.status,
      txHash: settlements.txHash,
      usdtAmount: settlements.usdtAmount,
      commission: settlements.commission,
      updatedAt: settlements.updatedAt,
    })
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .orderBy(desc(settlements.updatedAt))
    .limit(50);

  // Resolve user names for settlements
  const settlementUserIds = new Set<number>();
  for (const s of groupSettlements) {
    settlementUserIds.add(s.fromUser);
    settlementUserIds.add(s.toUser);
  }
  const settlementUserMap = new Map<number, string>();
  if (settlementUserIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(
        sql`${users.id} IN (${sql.join(
          [...settlementUserIds].map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    for (const u of userRows) settlementUserMap.set(u.id, u.displayName);
  }

  const viewerBase = tonviewerBase(c.env);

  // Collect images for moderation
  const images: Array<{ key: string; type: string; label: string }> = [];
  if (group.avatarKey) {
    images.push({ key: group.avatarKey, type: 'Group avatar', label: group.name });
  }
  for (const m of members) {
    if (m.avatarKey) {
      images.push({
        key: m.avatarKey,
        type: 'User avatar',
        label: m.displayName,
      });
    }
  }
  for (const e of recentExpenses) {
    if (e.receiptKey) {
      images.push({
        key: e.receiptKey,
        type: 'Receipt',
        label: e.description,
      });
    }
  }

  const memberRows = members
    .map((m) => {
      const placeholderBadge = m.isDummy
        ? ' <span class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">placeholder</span>'
        : '';
      return `<tr class="border-b">
      <td class="py-2 px-3">${escapeHtml(m.displayName)}${placeholderBadge}</td>
      <td class="py-2 px-3 text-gray-500">${m.username ? '@' + escapeHtml(m.username) : '-'}</td>
      <td class="py-2 px-3">${m.role}</td>
    </tr>`;
    })
    .join('');

  const expenseRows = recentExpenses
    .map(
      (e) =>
        `<tr class="border-b">
      <td class="py-2 px-3">${escapeHtml(e.description)}</td>
      <td class="py-2 px-3">${escapeHtml(e.payerName)}</td>
      <td class="py-2 px-3 text-right">${escapeHtml(formatAmount(e.amount, group.currency))}</td>
      <td class="py-2 px-3 text-gray-500 text-sm">${e.createdAt.split('T')[0]}</td>
    </tr>`,
    )
    .join('');

  const statusColors: Record<string, string> = {
    open: 'bg-yellow-100 text-yellow-800',
    payment_pending: 'bg-blue-100 text-blue-800',
    settled_onchain: 'bg-green-100 text-green-800',
    settled_external: 'bg-gray-100 text-gray-600',
  };

  const settlementRows = groupSettlements
    .map((s) => {
      const from = settlementUserMap.get(s.fromUser) ?? `#${s.fromUser}`;
      const to = settlementUserMap.get(s.toUser) ?? `#${s.toUser}`;
      const statusClass = statusColors[s.status] ?? 'bg-gray-100 text-gray-600';
      const statusLabel = s.status.replace(/_/g, ' ');
      const amountStr = formatAmount(s.amount, group.currency);
      const txLink =
        s.txHash && s.status === 'settled_onchain'
          ? ` <a href="${viewerBase}/transaction/${escapeHtml(s.txHash)}" target="_blank" class="text-blue-600 hover:underline font-mono text-xs">${escapeHtml(s.txHash.slice(0, 10))}...</a>`
          : '';
      const usdtStr = s.usdtAmount != null ? ` (${formatAmount(s.usdtAmount, 'USD')} USDT)` : '';
      return `<tr class="border-b">
      <td class="py-2 px-3">${escapeHtml(from)} &rarr; ${escapeHtml(to)}</td>
      <td class="py-2 px-3 text-right">${escapeHtml(amountStr)}${escapeHtml(usdtStr)}</td>
      <td class="py-2 px-3"><span class="text-xs px-2 py-0.5 rounded ${statusClass}">${escapeHtml(statusLabel)}</span>${txLink}</td>
      <td class="py-2 px-3 text-gray-500 text-sm">${s.updatedAt.split('T')[0]}</td>
    </tr>`;
    })
    .join('');

  const imageCards = images
    .map(
      (img) =>
        `<div class="bg-white rounded-lg border p-3 flex items-center gap-3">
      <img src="/r2/${escapeHtml(img.key)}" class="w-12 h-12 rounded object-cover" alt="">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">${escapeHtml(img.label)}</div>
        <div class="text-xs text-gray-500">${escapeHtml(img.type)}</div>
      </div>
      <form method="POST" action="/admin/images/delete" onsubmit="return confirm('Delete this image?')">
        <input type="hidden" name="imageKey" value="${escapeHtml(img.key)}">
        <input type="hidden" name="returnTo" value="/admin/groups/${groupId}">
        <button type="submit" class="text-red-600 text-sm hover:underline">Delete</button>
      </form>
    </div>`,
    )
    .join('');

  const deletedBanner = isDeleted
    ? `<div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 mb-4 text-sm">This group was deleted on ${group.deletedAt!.split('T')[0]}. On-chain settlements are retained for commission accounting.</div>`
    : '';

  const body = `
    <a href="/admin" class="text-blue-600 hover:underline text-sm">&larr; Back to dashboard</a>
    <h1 class="text-xl font-bold mt-2 mb-1">${escapeHtml(group.name)}${isDeleted ? ' <span class="text-sm text-red-400 font-normal">deleted</span>' : ''}</h1>
    <p class="text-sm text-gray-500 mb-4">Currency: ${escapeHtml(group.currency)} &middot; Created ${group.createdAt.split('T')[0]}</p>
    ${deletedBanner}

    ${
      members.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Members (${members.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr>
            <th class="py-2 px-3 text-left">Name</th>
            <th class="py-2 px-3 text-left">Username</th>
            <th class="py-2 px-3 text-left">Role</th>
          </tr>
        </thead>
        <tbody>${memberRows}</tbody>
      </table>
    </div>`
        : '<p class="text-sm text-gray-500 mb-6">No members (group deleted)</p>'
    }

    ${
      recentExpenses.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Recent Expenses (${recentExpenses.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr>
            <th class="py-2 px-3 text-left">Description</th>
            <th class="py-2 px-3 text-left">Paid by</th>
            <th class="py-2 px-3 text-right">Amount</th>
            <th class="py-2 px-3 text-left">Date</th>
          </tr>
        </thead>
        <tbody>${expenseRows}</tbody>
      </table>
    </div>`
        : ''
    }

    ${
      groupSettlements.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Settlements (${groupSettlements.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr>
            <th class="py-2 px-3 text-left">From &rarr; To</th>
            <th class="py-2 px-3 text-right">Amount</th>
            <th class="py-2 px-3 text-left">Status</th>
            <th class="py-2 px-3 text-left">Date</th>
          </tr>
        </thead>
        <tbody>${settlementRows}</tbody>
      </table>
    </div>`
        : ''
    }

    ${
      images.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Images (${images.length})</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">${imageCards}</div>`
        : ''
    }`;

  return c.html(layout(`Group: ${group.name}`, body, c.env));
});

// CSRF protection for POST requests — validate Origin/Referer matches the request host
app.post('*', async (c, next) => {
  const origin = c.req.header('Origin') || c.req.header('Referer');
  if (origin) {
    try {
      const requestHost = new URL(c.req.url).host;
      const originHost = new URL(origin).host;
      if (originHost !== requestHost) {
        return c.text('CSRF check failed', 403);
      }
    } catch {
      return c.text('CSRF check failed', 403);
    }
  }
  // If neither Origin nor Referer is present, block the request (safe default)
  if (!origin) {
    return c.text('CSRF check failed — missing Origin header', 403);
  }
  return next();
});

// --- Image Delete ---
app.post('/images/delete', async (c) => {
  const db = c.get('db');
  const body = await c.req.parseBody();
  const imageKey = typeof body['imageKey'] === 'string' ? body['imageKey'] : '';
  const returnTo = typeof body['returnTo'] === 'string' ? body['returnTo'] : '/admin';

  if (!imageKey) return c.text('Missing imageKey', 400);

  // Validate returnTo is a relative path to prevent open redirect
  if (returnTo && !returnTo.startsWith('/admin')) {
    return c.text('Invalid returnTo', 400);
  }

  await removeImage(c.env.IMAGES, db, imageKey);

  return c.redirect(returnTo);
});

export { app as adminApp };
