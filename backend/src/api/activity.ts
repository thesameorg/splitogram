import { Hono } from 'hono';
import { eq, and, desc, sql, inArray, lt } from 'drizzle-orm';
import { activityLog, groupMembers, users, groups } from '../db/schema';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type ActivityEnv = AuthContext & DBContext;

const activityApp = new Hono<ActivityEnv>();

// --- Cross-group activity feed ---
activityApp.get('/activity', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const cursor = c.req.query('cursor');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10) || 30, 50);

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Get user's groups
  const userGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, currentUser.id));

  if (userGroups.length === 0) {
    return c.json({ items: [], nextCursor: null });
  }

  const groupIds = userGroups.map((g) => g.groupId);

  // Fetch activity
  let query = db
    .select()
    .from(activityLog)
    .where(
      cursor
        ? and(inArray(activityLog.groupId, groupIds), lt(activityLog.id, parseInt(cursor, 10)))
        : inArray(activityLog.groupId, groupIds),
    )
    .orderBy(desc(activityLog.id))
    .limit(limit + 1);

  const rows = await query;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

  // Batch resolve actor names and group names
  const actorIds = [...new Set(items.map((i) => i.actorId))];
  const targetIds = [...new Set(items.filter((i) => i.targetUserId).map((i) => i.targetUserId!))];
  const allUserIds = [...new Set([...actorIds, ...targetIds])];
  const allGroupIds = [...new Set(items.map((i) => i.groupId))];

  const [userRows, groupRows] = await Promise.all([
    allUserIds.length > 0
      ? db
          .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
          .from(users)
          .where(inArray(users.id, allUserIds))
      : [],
    allGroupIds.length > 0
      ? db
          .select({ id: groups.id, name: groups.name })
          .from(groups)
          .where(inArray(groups.id, allGroupIds))
      : [],
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const groupMap = new Map(groupRows.map((g) => [g.id, g]));

  const enriched = items.map((item) => ({
    id: item.id,
    groupId: item.groupId,
    groupName: groupMap.get(item.groupId)?.name ?? 'Unknown',
    actorId: item.actorId,
    actorName: userMap.get(item.actorId)?.displayName ?? 'Unknown',
    actorAvatarKey: userMap.get(item.actorId)?.avatarKey ?? null,
    type: item.type,
    targetUserId: item.targetUserId,
    targetUserName: item.targetUserId
      ? (userMap.get(item.targetUserId)?.displayName ?? 'Unknown')
      : null,
    expenseId: item.expenseId,
    settlementId: item.settlementId,
    amount: item.amount,
    metadata: item.metadata ? JSON.parse(item.metadata) : null,
    createdAt: item.createdAt,
  }));

  return c.json({ items: enriched, nextCursor });
});

// --- Per-group activity feed ---
activityApp.get('/groups/:id/activity', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id'), 10);
  const cursor = c.req.query('cursor');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10) || 30, 50);

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

  // Fetch activity
  const rows = await db
    .select()
    .from(activityLog)
    .where(
      cursor
        ? and(eq(activityLog.groupId, groupId), lt(activityLog.id, parseInt(cursor, 10)))
        : eq(activityLog.groupId, groupId),
    )
    .orderBy(desc(activityLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

  // Batch resolve actor names
  const actorIds = [...new Set(items.map((i) => i.actorId))];
  const targetIds = [...new Set(items.filter((i) => i.targetUserId).map((i) => i.targetUserId!))];
  const allUserIds = [...new Set([...actorIds, ...targetIds])];

  const userRows =
    allUserIds.length > 0
      ? await db
          .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
          .from(users)
          .where(inArray(users.id, allUserIds))
      : [];

  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  const enriched = items.map((item) => ({
    id: item.id,
    groupId: item.groupId,
    groupName: group?.name ?? 'Unknown',
    actorId: item.actorId,
    actorName: userMap.get(item.actorId)?.displayName ?? 'Unknown',
    actorAvatarKey: userMap.get(item.actorId)?.avatarKey ?? null,
    type: item.type,
    targetUserId: item.targetUserId,
    targetUserName: item.targetUserId
      ? (userMap.get(item.targetUserId)?.displayName ?? 'Unknown')
      : null,
    expenseId: item.expenseId,
    settlementId: item.settlementId,
    amount: item.amount,
    metadata: item.metadata ? JSON.parse(item.metadata) : null,
    createdAt: item.createdAt,
  }));

  return c.json({ items: enriched, nextCursor });
});

export { activityApp };
