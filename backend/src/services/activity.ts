import { activityLog } from '../db/schema';
import type { Database } from '../db';

interface ActivityEntry {
  groupId: number;
  actorId: number;
  type:
    | 'group_created'
    | 'expense_created'
    | 'expense_edited'
    | 'expense_deleted'
    | 'settlement_completed'
    | 'member_joined'
    | 'member_left'
    | 'member_kicked';
  targetUserId?: number;
  expenseId?: number;
  settlementId?: number;
  amount?: number;
  metadata?: Record<string, unknown>;
}

export async function logActivity(db: Database, entry: ActivityEntry): Promise<void> {
  await db.insert(activityLog).values({
    groupId: entry.groupId,
    actorId: entry.actorId,
    type: entry.type,
    targetUserId: entry.targetUserId ?? null,
    expenseId: entry.expenseId ?? null,
    settlementId: entry.settlementId ?? null,
    amount: entry.amount ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
  });
}
