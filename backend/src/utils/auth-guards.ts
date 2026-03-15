import { eq, and } from 'drizzle-orm';
import { groupMembers } from '../db/schema';
import type { Database } from '../db';
import type { Context } from 'hono';

/** Check if a user is a member of a group. Returns the membership row or null. */
export async function getMembership(db: Database, groupId: number, userId: number) {
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return membership ?? null;
}

/** Check if a user is a member with a specific role. Returns the membership row or null. */
export async function getMembershipRole(db: Database, groupId: number, userId: number) {
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return membership ?? null;
}

/** Standard 403 response for non-members */
export function notMemberResponse(c: Context) {
  return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
}

/** Parse an integer route param. Returns the number or null if invalid. */
export function parseIntParam(c: Context, name: string): number | null {
  const v = parseInt(c.req.param(name) ?? '', 10);
  return isNaN(v) ? null : v;
}

/** Standard 400 response for invalid IDs */
export function invalidIdResponse(c: Context, label = 'ID') {
  return c.json({ error: 'invalid_id', detail: `Invalid ${label}` }, 400);
}
