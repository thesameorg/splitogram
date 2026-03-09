import { Hono } from 'hono';
import { sql, desc, eq } from 'drizzle-orm';
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

function layout(title: string, body: string): string {
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
    <a href="/admin" class="text-lg font-bold">Splitogram Admin</a>
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

  const [{ total: userCount }] = await db.select({ total: sql<number>`count(*)` }).from(users);
  const [{ total: groupCount }] = await db.select({ total: sql<number>`count(*)` }).from(groups);
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
      memberCount: sql<number>`(select count(*) from group_members where group_members.group_id = groups.id)`,
      expenseCount: sql<number>`(select count(*) from expenses where expenses.group_id = groups.id)`,
    })
    .from(groups)
    .where(
      showDeleted
        ? undefined
        : sql`(select count(*) from group_members where group_members.group_id = groups.id) > 0`,
    )
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

  const cards = `
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
      ${metricCard('Users', userCount)}
      ${metricCard('Groups', groupCount)}
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
    .map(
      (g) => `<tr class="border-b hover:bg-gray-50">
      <td class="py-2 px-3"><a href="/admin/groups/${g.id}" class="text-blue-600 hover:underline">${escapeHtml(g.name)}</a></td>
      <td class="py-2 px-3 text-center">${g.memberCount}</td>
      <td class="py-2 px-3 text-center">${g.expenseCount}</td>
      <td class="py-2 px-3 text-center">${escapeHtml(g.currency)}</td>
      <td class="py-2 px-3 text-gray-500 text-sm">${g.createdAt.split('T')[0]}</td>
    </tr>`,
    )
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
        Show deleted (0 members)
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

  return c.html(layout('Dashboard', cards + table));
});

// --- Group Detail ---
app.get('/groups/:id', async (c) => {
  const db = c.get('db');
  const groupId = parseInt(c.req.param('id'), 10);
  if (isNaN(groupId)) return c.text('Invalid group ID', 400);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return c.text('Group not found', 404);

  // Members
  const members = await db
    .select({
      userId: groupMembers.userId,
      role: groupMembers.role,
      displayName: users.displayName,
      username: users.username,
      avatarKey: users.avatarKey,
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
    .map(
      (m) =>
        `<tr class="border-b">
      <td class="py-2 px-3">${escapeHtml(m.displayName)}</td>
      <td class="py-2 px-3 text-gray-500">${m.username ? '@' + escapeHtml(m.username) : '-'}</td>
      <td class="py-2 px-3">${m.role}</td>
    </tr>`,
    )
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

  const body = `
    <a href="/admin" class="text-blue-600 hover:underline text-sm">&larr; Back to dashboard</a>
    <h1 class="text-xl font-bold mt-2 mb-1">${escapeHtml(group.name)}</h1>
    <p class="text-sm text-gray-500 mb-6">Currency: ${escapeHtml(group.currency)} &middot; Created ${group.createdAt.split('T')[0]}</p>

    <h2 class="text-lg font-semibold mb-3">Members (${members.length})</h2>
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
    </div>

    <h2 class="text-lg font-semibold mb-3">Recent Expenses (${recentExpenses.length})</h2>
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
    </div>

    ${
      images.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Images (${images.length})</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">${imageCards}</div>`
        : ''
    }`;

  return c.html(layout(`Group: ${group.name}`, body));
});

// --- Image Delete ---
app.post('/images/delete', async (c) => {
  const db = c.get('db');
  const body = await c.req.parseBody();
  const imageKey = typeof body['imageKey'] === 'string' ? body['imageKey'] : '';
  const returnTo = typeof body['returnTo'] === 'string' ? body['returnTo'] : '/admin';

  if (!imageKey) return c.text('Missing imageKey', 400);

  await removeImage(c.env.IMAGES, db, imageKey);

  return c.redirect(returnTo);
});

export { app as adminApp };
