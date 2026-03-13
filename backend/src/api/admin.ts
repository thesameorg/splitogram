import { Hono } from 'hono';
import { sql, desc, asc, eq, isNull, and } from 'drizzle-orm';
import {
  users,
  groups,
  groupMembers,
  expenses,
  settlements,
  activityLog,
  imageReports,
} from '../db/schema';
import { removeImage } from '../services/moderation';
import { formatAmount } from '../utils/format';
import { getExchangeRates, convertToMicroUsdt } from '../services/exchange-rates';
import type { Env } from '../env';
import type { Database } from '../db';

type AdminEnv = { Bindings: Env; Variables: { db: Database } };

const app = new Hono<AdminEnv>();

// Manual Basic Auth
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
      // malformed base64
    }
  }

  c.header('WWW-Authenticate', 'Basic realm="Splitogram Admin"');
  return c.text('Unauthorized', 401);
});

// --- Helpers ---

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tonviewerBase(env: Env): string {
  return env.TON_NETWORK === 'mainnet' ? 'https://tonviewer.com' : 'https://testnet.tonviewer.com';
}

type Tab = 'general' | 'groups' | 'users' | 'images';

function layout(title: string, body: string, env: Env, activeTab?: Tab): string {
  const network = env.TON_NETWORK === 'mainnet' ? '' : '[testnet]';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'groups', label: 'Groups' },
    { id: 'users', label: 'Users' },
    { id: 'images', label: 'Images' },
  ];
  const tabsHtml = activeTab
    ? `<div class="flex gap-1 border-b mb-6">${tabs
        .map((t) => {
          const active = t.id === activeTab;
          const cls = active
            ? 'px-4 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600'
            : 'px-4 py-2 text-sm text-gray-500 hover:text-gray-700';
          return `<a href="/admin?tab=${t.id}" class="${cls}">${t.label}</a>`;
        })
        .join('')}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — Splitogram Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 text-gray-900 min-h-screen">
  <nav class="bg-white border-b px-4 py-3 flex items-center gap-3">
    <a href="/admin" class="text-lg font-bold">Splitogram Admin</a>
    ${network ? `<span class="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded">${esc(network)}</span>` : ''}
  </nav>
  <main class="max-w-6xl mx-auto px-4 py-6">${tabsHtml}${body}</main>
</body>
</html>`;
}

function card(label: string, value: string | number, sub?: string): string {
  return `<div class="bg-white rounded-lg border p-4">
    <div class="text-sm text-gray-500">${esc(label)}</div>
    <div class="text-2xl font-bold mt-1">${esc(String(value))}</div>
    ${sub ? `<div class="text-xs text-gray-400 mt-0.5">${esc(sub)}</div>` : ''}
  </div>`;
}

function sortHeader(
  label: string,
  col: string,
  currentSort: string,
  currentDir: string,
  baseUrl: string,
): string {
  const active = currentSort === col;
  const nextDir = active && currentDir === 'desc' ? 'asc' : 'desc';
  const arrow = active ? (currentDir === 'desc' ? ' ↓' : ' ↑') : '';
  const cls = active ? 'text-blue-600' : 'text-gray-700 hover:text-blue-600';
  return `<a href="${baseUrl}&sort=${col}&dir=${nextDir}" class="${cls} whitespace-nowrap">${esc(label)}${arrow}</a>`;
}

function dateStr(d: string | null | undefined): string {
  if (!d) return '-';
  return d.split('T')[0];
}

function timeAgo(d: string | null | undefined): string {
  if (!d) return '-';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return dateStr(d);
}

// --- Dashboard with tabs ---
app.get('/', async (c) => {
  const tab = (c.req.query('tab') as Tab) || 'general';
  const db = c.get('db');

  if (tab === 'general') return generalTab(c, db);
  if (tab === 'groups') return groupsTab(c, db);
  if (tab === 'users') return usersTab(c, db);
  if (tab === 'images') return imagesTab(c, db);
  return generalTab(c, db);
});

// --- General Tab ---
async function generalTab(c: any, db: Database) {
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ total: expenseCount }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(expenses)
    .where(sql`${expenses.createdAt} > ${thirtyDaysAgo}`);
  const [{ total: expenseCountAll }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(expenses);
  const [{ total: settlementCount }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(settlements)
    .where(sql`${settlements.createdAt} > ${thirtyDaysAgo}`);
  const [{ total: settlementCountAll }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(settlements);

  const [{ total: activeGroups30d }] = await db
    .select({ total: sql<number>`count(distinct ${expenses.groupId})` })
    .from(expenses)
    .where(sql`${expenses.createdAt} > ${thirtyDaysAgo}`);

  // On-chain stats (all-time — these are rare enough to show total)
  const [onchainStats] = await db
    .select({
      count: sql<number>`count(*)`,
      volume: sql<number>`coalesce(sum(${settlements.usdtAmount}), 0)`,
      fees: sql<number>`coalesce(sum(${settlements.commission}), 0)`,
    })
    .from(settlements)
    .where(eq(settlements.status, 'settled_onchain'));

  // Total money tracked (last 30d, per currency → converted to USD)
  const expenseByCurrency = await db
    .select({
      currency: groups.currency,
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .innerJoin(groups, eq(expenses.groupId, groups.id))
    .where(sql`${expenses.createdAt} > ${thirtyDaysAgo}`)
    .groupBy(groups.currency);

  let totalTracked30dUsd: number | null = null;
  const trackedByCurrency: string[] = [];

  if (expenseByCurrency.length > 0) {
    // Try to get exchange rates for conversion
    let rates: Record<string, number> | null = null;
    try {
      const ratesResult = await getExchangeRates(c.env.KV);
      rates = ratesResult?.rates ?? null;
    } catch {
      // KV unavailable
    }

    let totalMicroUsd = 0;
    let allConverted = true;

    for (const row of expenseByCurrency) {
      trackedByCurrency.push(`${formatAmount(row.total, row.currency)} ${row.currency}`);
      if (rates) {
        const usd = convertToMicroUsdt(row.total, row.currency, rates);
        if (usd != null) {
          totalMicroUsd += usd;
        } else {
          allConverted = false;
        }
      } else {
        allConverted = false;
      }
    }

    if (allConverted && totalMicroUsd > 0) {
      totalTracked30dUsd = totalMicroUsd;
    }
  }

  const trackedStr =
    totalTracked30dUsd != null
      ? `~${formatAmount(totalTracked30dUsd, 'USD')}`
      : trackedByCurrency.length > 0
        ? trackedByCurrency.join(', ')
        : '0';

  // On-chain txs
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

  // Resolve names
  const userIds = new Set<number>();
  const groupIds = new Set<number>();
  for (const tx of onchainTxs) {
    userIds.add(tx.fromUser);
    userIds.add(tx.toUser);
    groupIds.add(tx.groupId);
  }
  const userMap = await resolveUserNames(db, userIds);
  const groupMap = await resolveGroupNames(db, groupIds);

  const viewerBase = tonviewerBase(c.env);

  const cards = `
    <h2 class="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">Last 30 days</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      ${card('Active Groups', activeGroups30d, `${activeGroupCount} total`)}
      ${card('Expenses', expenseCount, `${expenseCountAll} total`)}
      ${card('Settlements', settlementCount, `${settlementCountAll} total`)}
      ${card('Tracked', trackedStr, trackedByCurrency.length > 1 ? trackedByCurrency.join(' · ') : undefined)}
    </div>
    <h2 class="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">Totals</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      ${card('Users', realUsers, dummyUsers > 0 ? `+${dummyUsers} placeholders` : undefined)}
      ${card('Groups', activeGroupCount, deletedGroupCount > 0 ? `+${deletedGroupCount} deleted` : undefined)}
      ${card('On-chain TXs', onchainStats.count)}
      ${card('Volume / Fees', '~' + formatAmount(onchainStats.volume, 'USD'), 'fees: ~' + formatAmount(onchainStats.fees, 'USD'))}
    </div>`;

  // TX table
  const txRows = onchainTxs
    .map((tx) => {
      const amount = tx.usdtAmount != null ? formatAmount(tx.usdtAmount, 'USD') : '-';
      const fee = tx.commission != null ? formatAmount(tx.commission, 'USD') : '-';
      const from = userMap.get(tx.fromUser) ?? `#${tx.fromUser}`;
      const to = userMap.get(tx.toUser) ?? `#${tx.toUser}`;
      const gName = groupMap.get(tx.groupId);
      const groupHtml = gName
        ? `<a href="/admin/groups/${tx.groupId}" class="text-blue-600 hover:underline">${esc(gName)}</a>`
        : `#${tx.groupId}`;
      const txLink = tx.txHash
        ? `<a href="${viewerBase}/transaction/${esc(tx.txHash)}" target="_blank" class="text-blue-600 hover:underline font-mono text-xs">${esc(tx.txHash.slice(0, 10))}…</a>`
        : '-';
      return `<tr class="border-b hover:bg-gray-50">
        <td class="py-2 px-3">${txLink}</td>
        <td class="py-2 px-3"><a href="/admin/users/${tx.fromUser}" class="hover:underline">${esc(from)}</a></td>
        <td class="py-2 px-3"><a href="/admin/users/${tx.toUser}" class="hover:underline">${esc(to)}</a></td>
        <td class="py-2 px-3 text-right">${esc(amount)}</td>
        <td class="py-2 px-3 text-right">${esc(fee)}</td>
        <td class="py-2 px-3">${groupHtml}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(tx.updatedAt)}</td>
      </tr>`;
    })
    .join('');

  const txTable =
    onchainTxs.length > 0
      ? `<h2 class="text-lg font-semibold mb-3">On-chain Transactions</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">TX Hash</th>
          <th class="py-2 px-3 text-left">From</th>
          <th class="py-2 px-3 text-left">To</th>
          <th class="py-2 px-3 text-right">USDT</th>
          <th class="py-2 px-3 text-right">Fee</th>
          <th class="py-2 px-3 text-left">Group</th>
          <th class="py-2 px-3 text-left">Date</th>
        </tr></thead>
        <tbody>${txRows}</tbody>
      </table>
    </div>`
      : '';

  return c.html(layout('Dashboard', cards + txTable, c.env, 'general'));
}

// --- Groups Tab ---
async function groupsTab(c: any, db: Database) {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const perPage = 30;
  const offset = (page - 1) * perPage;
  const showDeleted = c.req.query('deleted') === '1';
  const sort = c.req.query('sort') || 'activity';
  const dir = c.req.query('dir') || 'desc';

  const orderCol =
    sort === 'name'
      ? groups.name
      : sort === 'members'
        ? sql`member_count`
        : sort === 'expenses'
          ? sql`expense_count`
          : sort === 'created'
            ? groups.createdAt
            : sql`last_activity`; // default: activity

  const orderDir = dir === 'asc' ? asc : desc;

  const whereClause = showDeleted ? undefined : isNull(groups.deletedAt);

  const groupRows = await db
    .select({
      id: groups.id,
      name: groups.name,
      currency: groups.currency,
      createdAt: groups.createdAt,
      deletedAt: groups.deletedAt,
      memberCount:
        sql<number>`(select count(*) from group_members where group_members.group_id = groups.id)`.as(
          'member_count',
        ),
      expenseCount:
        sql<number>`(select count(*) from expenses where expenses.group_id = groups.id)`.as(
          'expense_count',
        ),
      imageCount:
        sql<number>`(select count(*) from expenses where expenses.group_id = groups.id and expenses.receipt_key is not null)`.as(
          'image_count',
        ),
      lastActivity:
        sql<string>`(select max(created_at) from activity_log where activity_log.group_id = groups.id)`.as(
          'last_activity',
        ),
    })
    .from(groups)
    .where(whereClause)
    .orderBy(orderDir(orderCol))
    .limit(perPage)
    .offset(offset);

  const [{ total: deletedCount }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(groups)
    .where(sql`${groups.deletedAt} IS NOT NULL`);

  const hasMore = groupRows.length === perPage;
  const baseUrl = `/admin?tab=groups&deleted=${showDeleted ? '1' : '0'}&page=${page}`;
  const toggleUrl = showDeleted
    ? `/admin?tab=groups&deleted=0&page=1`
    : `/admin?tab=groups&deleted=1&page=1`;

  const headerRow = `<tr>
    <th class="py-2 px-3 text-left">${sortHeader('Name', 'name', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-center">${sortHeader('Members', 'members', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-center">${sortHeader('Expenses', 'expenses', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-center">Imgs</th>
    <th class="py-2 px-3 text-center">Currency</th>
    <th class="py-2 px-3 text-left">${sortHeader('Created', 'created', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-left">${sortHeader('Last Activity', 'activity', sort, dir, baseUrl)}</th>
  </tr>`;

  const rows = groupRows
    .map((g) => {
      const deleted = g.deletedAt != null;
      const nameClass = deleted ? 'text-gray-400' : 'text-blue-600 hover:underline';
      const nameHtml = `<a href="/admin/groups/${g.id}" class="${nameClass}">${esc(g.name)}</a>${deleted ? ' <span class="text-xs text-red-400">deleted</span>' : ''}`;
      return `<tr class="border-b hover:bg-gray-50">
        <td class="py-2 px-3">${nameHtml}</td>
        <td class="py-2 px-3 text-center">${g.memberCount}</td>
        <td class="py-2 px-3 text-center">${g.expenseCount}</td>
        <td class="py-2 px-3 text-center text-gray-400">${g.imageCount || '-'}</td>
        <td class="py-2 px-3 text-center">${esc(g.currency)}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(g.createdAt)}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${timeAgo(g.lastActivity)}</td>
      </tr>`;
    })
    .join('');

  const paginationBase = `/admin?tab=groups&deleted=${showDeleted ? '1' : '0'}&sort=${sort}&dir=${dir}`;
  const pagination = `<div class="flex gap-4 mt-4">
    ${page > 1 ? `<a href="${paginationBase}&page=${page - 1}" class="text-blue-600 hover:underline">← Prev</a>` : ''}
    <span class="text-gray-500">Page ${page}</span>
    ${hasMore ? `<a href="${paginationBase}&page=${page + 1}" class="text-blue-600 hover:underline">Next →</a>` : ''}
  </div>`;

  const body = `
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold">Groups</h2>
      <a href="${toggleUrl}" class="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" ${showDeleted ? 'checked' : ''} class="rounded pointer-events-none">
        <span>Include deleted (${deletedCount})</span>
      </a>
    </div>
    <div class="bg-white rounded-lg border overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">${headerRow}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pagination}`;

  return c.html(layout('Groups', body, c.env, 'groups'));
}

// --- Users Tab ---
async function usersTab(c: any, db: Database) {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const perPage = 30;
  const offset = (page - 1) * perPage;
  const showDummy = c.req.query('dummy') === '1';
  const sort = c.req.query('sort') || 'activity';
  const dir = c.req.query('dir') || 'desc';

  const orderCol =
    sort === 'name'
      ? users.displayName
      : sort === 'groups'
        ? sql`group_count`
        : sort === 'expenses'
          ? sql`expense_count`
          : sort === 'created'
            ? users.createdAt
            : sql`last_activity`;

  const orderDir = dir === 'asc' ? asc : desc;

  const whereClause = showDummy ? undefined : eq(users.isDummy, false);

  const userRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      isDummy: users.isDummy,
      createdAt: users.createdAt,
      walletAddress: users.walletAddress,
      groupCount:
        sql<number>`(select count(*) from group_members where group_members.user_id = users.id)`.as(
          'group_count',
        ),
      expenseCount:
        sql<number>`(select count(*) from expenses where expenses.paid_by = users.id)`.as(
          'expense_count',
        ),
      lastActivity:
        sql<string>`(select max(created_at) from activity_log where activity_log.actor_id = users.id)`.as(
          'last_activity',
        ),
    })
    .from(users)
    .where(whereClause)
    .orderBy(orderDir(orderCol))
    .limit(perPage)
    .offset(offset);

  const [{ total: dummyCount }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.isDummy, true));

  const [{ total: totalReal }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.isDummy, false));

  const hasMore = userRows.length === perPage;
  const baseUrl = `/admin?tab=users&dummy=${showDummy ? '1' : '0'}&page=${page}`;
  const toggleUrl = showDummy
    ? `/admin?tab=users&dummy=0&page=1`
    : `/admin?tab=users&dummy=1&page=1`;

  const headerRow = `<tr>
    <th class="py-2 px-3 text-left">${sortHeader('Name', 'name', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-left">Username</th>
    <th class="py-2 px-3 text-center">${sortHeader('Groups', 'groups', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-center">${sortHeader('Expenses', 'expenses', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-left">${sortHeader('Created', 'created', sort, dir, baseUrl)}</th>
    <th class="py-2 px-3 text-left">${sortHeader('Last Activity', 'activity', sort, dir, baseUrl)}</th>
  </tr>`;

  const rows = userRows
    .map((u) => {
      const badge = u.isDummy
        ? ' <span class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">placeholder</span>'
        : '';
      const wallet = u.walletAddress
        ? ' <span class="text-xs text-green-600">💎</span>'
        : '';
      return `<tr class="border-b hover:bg-gray-50">
        <td class="py-2 px-3"><a href="/admin/users/${u.id}" class="text-blue-600 hover:underline">${esc(u.displayName)}</a>${badge}${wallet}</td>
        <td class="py-2 px-3 text-gray-500">${u.username ? '@' + esc(u.username) : '-'}</td>
        <td class="py-2 px-3 text-center">${u.groupCount}</td>
        <td class="py-2 px-3 text-center">${u.expenseCount}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(u.createdAt)}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${timeAgo(u.lastActivity)}</td>
      </tr>`;
    })
    .join('');

  const paginationBase = `/admin?tab=users&dummy=${showDummy ? '1' : '0'}&sort=${sort}&dir=${dir}`;
  const pagination = `<div class="flex gap-4 mt-4">
    ${page > 1 ? `<a href="${paginationBase}&page=${page - 1}" class="text-blue-600 hover:underline">← Prev</a>` : ''}
    <span class="text-gray-500">Page ${page}</span>
    ${hasMore ? `<a href="${paginationBase}&page=${page + 1}" class="text-blue-600 hover:underline">Next →</a>` : ''}
  </div>`;

  const body = `
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold">Users <span class="text-sm font-normal text-gray-500">(${totalReal} real)</span></h2>
      <a href="${toggleUrl}" class="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" ${showDummy ? 'checked' : ''} class="rounded pointer-events-none">
        <span>Include placeholders (${dummyCount})</span>
      </a>
    </div>
    <div class="bg-white rounded-lg border overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">${headerRow}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pagination}`;

  return c.html(layout('Users', body, c.env, 'users'));
}

// --- Images Tab ---
async function imagesTab(c: any, db: Database) {
  const reports = await db
    .select()
    .from(imageReports)
    .orderBy(desc(imageReports.createdAt))
    .limit(50);

  const rows = reports
    .map((r) => {
      const statusColors: Record<string, string> = {
        pending: 'bg-yellow-100 text-yellow-800',
        rejected: 'bg-gray-100 text-gray-600',
        removed: 'bg-red-100 text-red-800',
      };
      const cls = statusColors[r.status] ?? 'bg-gray-100 text-gray-600';
      return `<tr class="border-b hover:bg-gray-50">
        <td class="py-2 px-3">
          <img src="/r2/${esc(r.imageKey)}" class="w-10 h-10 rounded object-cover inline-block" alt="" onerror="this.style.display='none'">
          <span class="text-xs text-gray-500 ml-2 font-mono">${esc(r.imageKey.length > 30 ? '…' + r.imageKey.slice(-30) : r.imageKey)}</span>
        </td>
        <td class="py-2 px-3">${esc(r.reason)}</td>
        <td class="py-2 px-3"><span class="text-xs px-2 py-0.5 rounded ${cls}">${esc(r.status)}</span></td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(r.createdAt)}</td>
      </tr>`;
    })
    .join('');

  const body =
    reports.length > 0
      ? `<h2 class="text-lg font-semibold mb-3">Image Reports</h2>
    <div class="bg-white rounded-lg border overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">Image</th>
          <th class="py-2 px-3 text-left">Reason</th>
          <th class="py-2 px-3 text-left">Status</th>
          <th class="py-2 px-3 text-left">Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
      : '<p class="text-gray-500">No image reports yet.</p>';

  return c.html(layout('Images', body, c.env, 'images'));
}

// --- Group Detail ---
app.get('/groups/:id', async (c) => {
  const db = c.get('db');
  const groupId = parseInt(c.req.param('id'), 10);
  if (isNaN(groupId)) return c.text('Invalid group ID', 400);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return c.text('Group not found', 404);

  const isDeleted = group.deletedAt != null;

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

  const recentExpenses = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      description: expenses.description,
      paidBy: expenses.paidBy,
      payerName: users.displayName,
      receiptKey: expenses.receiptKey,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(users, eq(expenses.paidBy, users.id))
    .where(eq(expenses.groupId, groupId))
    .orderBy(desc(expenses.createdAt))
    .limit(50);

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

  const settlementUserIds = new Set<number>();
  for (const s of groupSettlements) {
    settlementUserIds.add(s.fromUser);
    settlementUserIds.add(s.toUser);
  }
  const settlementUserMap = await resolveUserNames(db, settlementUserIds);
  const viewerBase = tonviewerBase(c.env);

  // Images
  const images: Array<{ key: string; type: string; label: string }> = [];
  if (group.avatarKey) {
    images.push({ key: group.avatarKey, type: 'Group avatar', label: group.name });
  }
  for (const m of members) {
    if (m.avatarKey) {
      images.push({ key: m.avatarKey, type: 'User avatar', label: m.displayName });
    }
  }
  for (const e of recentExpenses) {
    if (e.receiptKey) {
      images.push({ key: e.receiptKey, type: 'Receipt', label: e.description });
    }
  }

  const memberRows = members
    .map((m) => {
      const badge = m.isDummy
        ? ' <span class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">placeholder</span>'
        : '';
      return `<tr class="border-b">
        <td class="py-2 px-3"><a href="/admin/users/${m.userId}" class="text-blue-600 hover:underline">${esc(m.displayName)}</a>${badge}</td>
        <td class="py-2 px-3 text-gray-500">${m.username ? '@' + esc(m.username) : '-'}</td>
        <td class="py-2 px-3">${m.role}</td>
      </tr>`;
    })
    .join('');

  const expenseRows = recentExpenses
    .map(
      (e) =>
        `<tr class="border-b">
        <td class="py-2 px-3">${esc(e.description)}</td>
        <td class="py-2 px-3"><a href="/admin/users/${e.paidBy}" class="text-blue-600 hover:underline">${esc(e.payerName)}</a></td>
        <td class="py-2 px-3 text-right">${esc(formatAmount(e.amount, group.currency))}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(e.createdAt)}</td>
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
          ? ` <a href="${viewerBase}/transaction/${esc(s.txHash)}" target="_blank" class="text-blue-600 hover:underline font-mono text-xs">${esc(s.txHash.slice(0, 10))}…</a>`
          : '';
      const usdtStr = s.usdtAmount != null ? ` (${formatAmount(s.usdtAmount, 'USD')} USDT)` : '';
      return `<tr class="border-b">
        <td class="py-2 px-3"><a href="/admin/users/${s.fromUser}" class="hover:underline">${esc(from)}</a> → <a href="/admin/users/${s.toUser}" class="hover:underline">${esc(to)}</a></td>
        <td class="py-2 px-3 text-right">${esc(amountStr)}${esc(usdtStr)}</td>
        <td class="py-2 px-3"><span class="text-xs px-2 py-0.5 rounded ${statusClass}">${esc(statusLabel)}</span>${txLink}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(s.updatedAt)}</td>
      </tr>`;
    })
    .join('');

  const imageCards = images
    .map(
      (img) =>
        `<div class="bg-white rounded-lg border p-3 flex items-center gap-3">
        <img src="/r2/${esc(img.key)}" class="w-12 h-12 rounded object-cover" alt="" onerror="this.style.display='none'">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${esc(img.label)}</div>
          <div class="text-xs text-gray-500">${esc(img.type)}</div>
        </div>
        <form method="POST" action="/admin/images/delete" onsubmit="return confirm('Delete this image?')">
          <input type="hidden" name="imageKey" value="${esc(img.key)}">
          <input type="hidden" name="returnTo" value="/admin/groups/${groupId}">
          <button type="submit" class="text-red-600 text-sm hover:underline">Delete</button>
        </form>
      </div>`,
    )
    .join('');

  const deletedBanner = isDeleted
    ? `<div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 mb-4 text-sm">This group was deleted on ${dateStr(group.deletedAt)}. On-chain settlements are retained.</div>`
    : '';

  const body = `
    <a href="/admin?tab=groups" class="text-blue-600 hover:underline text-sm">← Back to groups</a>
    <h1 class="text-xl font-bold mt-2 mb-1">${esc(group.name)}${isDeleted ? ' <span class="text-sm text-red-400 font-normal">deleted</span>' : ''}</h1>
    <p class="text-sm text-gray-500 mb-4">Currency: ${esc(group.currency)} · Created ${dateStr(group.createdAt)}</p>
    ${deletedBanner}

    ${
      members.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Members (${members.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">Name</th>
          <th class="py-2 px-3 text-left">Username</th>
          <th class="py-2 px-3 text-left">Role</th>
        </tr></thead>
        <tbody>${memberRows}</tbody>
      </table>
    </div>`
        : '<p class="text-sm text-gray-500 mb-6">No members (group deleted)</p>'
    }

    ${
      recentExpenses.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Expenses (${recentExpenses.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">Description</th>
          <th class="py-2 px-3 text-left">Paid by</th>
          <th class="py-2 px-3 text-right">Amount</th>
          <th class="py-2 px-3 text-left">Date</th>
        </tr></thead>
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
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">From → To</th>
          <th class="py-2 px-3 text-right">Amount</th>
          <th class="py-2 px-3 text-left">Status</th>
          <th class="py-2 px-3 text-left">Date</th>
        </tr></thead>
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

// --- User Detail ---
app.get('/users/:id', async (c) => {
  const db = c.get('db');
  const userId = parseInt(c.req.param('id'), 10);
  if (isNaN(userId)) return c.text('Invalid user ID', 400);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.text('User not found', 404);

  // User's groups
  const userGroups = await db
    .select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
      netBalance: groupMembers.netBalance,
      groupName: groups.name,
      currency: groups.currency,
      deletedAt: groups.deletedAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, userId));

  // User's recent expenses
  const userExpenses = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      description: expenses.description,
      groupId: expenses.groupId,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .where(eq(expenses.paidBy, userId))
    .orderBy(desc(expenses.createdAt))
    .limit(30);

  // Resolve group names for expenses
  const expGroupIds = new Set(userExpenses.map((e) => e.groupId));
  const expGroupMap = await resolveGroupNames(db, expGroupIds);

  // User's settlements
  const userSettlements = await db
    .select({
      id: settlements.id,
      groupId: settlements.groupId,
      fromUser: settlements.fromUser,
      toUser: settlements.toUser,
      amount: settlements.amount,
      status: settlements.status,
      txHash: settlements.txHash,
      usdtAmount: settlements.usdtAmount,
      updatedAt: settlements.updatedAt,
    })
    .from(settlements)
    .where(sql`${settlements.fromUser} = ${userId} OR ${settlements.toUser} = ${userId}`)
    .orderBy(desc(settlements.updatedAt))
    .limit(30);

  const settGroupIds = new Set(userSettlements.map((s) => s.groupId));
  const settUserIds = new Set<number>();
  for (const s of userSettlements) {
    settUserIds.add(s.fromUser);
    settUserIds.add(s.toUser);
  }
  const settGroupMap = await resolveGroupNames(db, settGroupIds);
  const settUserMap = await resolveUserNames(db, settUserIds);

  // Last activity
  const [lastAct] = await db
    .select({ t: sql<string>`max(${activityLog.createdAt})` })
    .from(activityLog)
    .where(eq(activityLog.actorId, userId));

  const viewerBase = tonviewerBase(c.env);

  const badges = [
    user.isDummy
      ? '<span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">placeholder</span>'
      : null,
    user.walletAddress
      ? '<span class="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">wallet connected</span>'
      : null,
    user.botStarted
      ? '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">bot started</span>'
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const groupRows = userGroups
    .map((g) => {
      const deleted = g.deletedAt != null;
      const nameClass = deleted ? 'text-gray-400' : 'text-blue-600 hover:underline';
      return `<tr class="border-b">
        <td class="py-2 px-3"><a href="/admin/groups/${g.groupId}" class="${nameClass}">${esc(g.groupName)}</a>${deleted ? ' <span class="text-xs text-red-400">deleted</span>' : ''}</td>
        <td class="py-2 px-3">${g.role}</td>
        <td class="py-2 px-3 text-right ${g.netBalance > 0 ? 'text-green-600' : g.netBalance < 0 ? 'text-red-600' : ''}">${formatAmount(g.netBalance, g.currency)}</td>
        <td class="py-2 px-3 text-gray-500">${esc(g.currency)}</td>
      </tr>`;
    })
    .join('');

  const expenseRows = userExpenses
    .map((e) => {
      const gName = expGroupMap.get(e.groupId) ?? `#${e.groupId}`;
      return `<tr class="border-b">
        <td class="py-2 px-3">${esc(e.description)}</td>
        <td class="py-2 px-3"><a href="/admin/groups/${e.groupId}" class="text-blue-600 hover:underline">${esc(gName)}</a></td>
        <td class="py-2 px-3 text-right">${esc(String(e.amount))}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(e.createdAt)}</td>
      </tr>`;
    })
    .join('');

  const statusColors: Record<string, string> = {
    open: 'bg-yellow-100 text-yellow-800',
    payment_pending: 'bg-blue-100 text-blue-800',
    settled_onchain: 'bg-green-100 text-green-800',
    settled_external: 'bg-gray-100 text-gray-600',
  };

  const settlementRows = userSettlements
    .map((s) => {
      const from = settUserMap.get(s.fromUser) ?? `#${s.fromUser}`;
      const to = settUserMap.get(s.toUser) ?? `#${s.toUser}`;
      const gName = settGroupMap.get(s.groupId) ?? `#${s.groupId}`;
      const statusClass = statusColors[s.status] ?? 'bg-gray-100 text-gray-600';
      const txLink =
        s.txHash && s.status === 'settled_onchain'
          ? ` <a href="${viewerBase}/transaction/${esc(s.txHash)}" target="_blank" class="text-blue-600 hover:underline font-mono text-xs">${esc(s.txHash.slice(0, 10))}…</a>`
          : '';
      return `<tr class="border-b">
        <td class="py-2 px-3">${esc(from)} → ${esc(to)}</td>
        <td class="py-2 px-3"><a href="/admin/groups/${s.groupId}" class="text-blue-600 hover:underline">${esc(gName)}</a></td>
        <td class="py-2 px-3"><span class="text-xs px-2 py-0.5 rounded ${statusClass}">${esc(s.status.replace(/_/g, ' '))}</span>${txLink}</td>
        <td class="py-2 px-3 text-gray-500 text-sm">${dateStr(s.updatedAt)}</td>
      </tr>`;
    })
    .join('');

  const body = `
    <a href="/admin?tab=users" class="text-blue-600 hover:underline text-sm">← Back to users</a>
    <h1 class="text-xl font-bold mt-2 mb-1">${esc(user.displayName)}</h1>
    <p class="text-sm text-gray-500 mb-1">${user.username ? '@' + esc(user.username) : 'no username'} · TG ID: ${user.telegramId} · Created ${dateStr(user.createdAt)}</p>
    <p class="text-sm text-gray-500 mb-1">Last activity: ${timeAgo(lastAct?.t)}</p>
    ${user.walletAddress ? `<p class="text-sm text-gray-500 mb-1 font-mono">${esc(user.walletAddress)}</p>` : ''}
    <div class="flex gap-2 mb-4 mt-2">${badges}</div>

    ${
      userGroups.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Groups (${userGroups.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">Group</th>
          <th class="py-2 px-3 text-left">Role</th>
          <th class="py-2 px-3 text-right">Balance</th>
          <th class="py-2 px-3 text-left">Currency</th>
        </tr></thead>
        <tbody>${groupRows}</tbody>
      </table>
    </div>`
        : '<p class="text-sm text-gray-500 mb-6">No groups</p>'
    }

    ${
      userExpenses.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Recent Expenses (${userExpenses.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">Description</th>
          <th class="py-2 px-3 text-left">Group</th>
          <th class="py-2 px-3 text-right">Amount</th>
          <th class="py-2 px-3 text-left">Date</th>
        </tr></thead>
        <tbody>${expenseRows}</tbody>
      </table>
    </div>`
        : ''
    }

    ${
      userSettlements.length > 0
        ? `<h2 class="text-lg font-semibold mb-3">Settlements (${userSettlements.length})</h2>
    <div class="bg-white rounded-lg border overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead class="bg-gray-100"><tr>
          <th class="py-2 px-3 text-left">From → To</th>
          <th class="py-2 px-3 text-left">Group</th>
          <th class="py-2 px-3 text-left">Status</th>
          <th class="py-2 px-3 text-left">Date</th>
        </tr></thead>
        <tbody>${settlementRows}</tbody>
      </table>
    </div>`
        : ''
    }`;

  return c.html(layout(`User: ${user.displayName}`, body, c.env));
});

// CSRF protection for POST requests
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
  if (returnTo && !returnTo.startsWith('/admin')) {
    return c.text('Invalid returnTo', 400);
  }

  await removeImage(c.env.IMAGES, db, imageKey);
  return c.redirect(returnTo);
});

// --- Helpers for resolving names ---

async function resolveUserNames(db: Database, ids: Set<number>): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.size === 0) return map;
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(
      sql`${users.id} IN (${sql.join(
        [...ids].map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  for (const u of rows) map.set(u.id, u.displayName);
  return map;
}

async function resolveGroupNames(db: Database, ids: Set<number>): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.size === 0) return map;
  const rows = await db
    .select({ id: groups.id, name: groups.name, deletedAt: groups.deletedAt })
    .from(groups)
    .where(
      sql`${groups.id} IN (${sql.join(
        [...ids].map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  for (const g of rows) map.set(g.id, g.deletedAt ? `${g.name} (deleted)` : g.name);
  return map;
}

export { app as adminApp };
