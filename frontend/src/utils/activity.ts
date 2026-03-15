import type { ActivityItem } from '../services/api';
import { formatAmount } from './format';

export function getActivityText(
  item: ActivityItem,
  t: (key: string, opts?: Record<string, unknown>) => string,
  currentUserId: number | null,
  currency?: string,
): string {
  const actor = item.actorId === currentUserId ? t('activity.you') : item.actorName;
  const target =
    item.targetUserId === currentUserId ? t('activity.you').toLowerCase() : item.targetUserName;
  const meta = item.metadata as Record<string, unknown> | null;
  const desc = meta?.description as string | undefined;

  switch (item.type) {
    case 'group_created':
      return t('activity.groupCreated', { actor });
    case 'expense_created':
      return t('activity.expenseCreated', { actor, description: desc ?? '' });
    case 'expense_edited': {
      const oldAmount = meta?.oldAmount as number | undefined;
      if (oldAmount != null && item.amount != null && oldAmount !== item.amount) {
        return t('activity.expenseEditedWithAmount', {
          actor,
          description: desc ?? '',
          oldAmount: formatAmount(oldAmount, currency),
          newAmount: formatAmount(item.amount, currency),
        });
      }
      return t('activity.expenseEdited', { actor, description: desc ?? '' });
    }
    case 'expense_deleted':
      return t('activity.expenseDeleted', { actor, description: desc ?? '' });
    case 'settlement_completed':
      return t('activity.settlementCompleted', { actor, target: target ?? '' });
    case 'member_joined':
      return t('activity.memberJoined', { actor });
    case 'member_left':
      return t('activity.memberLeft', { actor });
    case 'member_kicked':
      return t('activity.memberKicked', { actor, target: target ?? '' });
    case 'placeholder_claimed':
      return t('activity.placeholderClaimed', {
        actor,
        dummyName: (meta?.dummyName as string) ?? '',
      });
    case 'member_deleted':
      return t('activity.memberDeleted', {
        originalName: (meta?.originalName as string) ?? '',
        dummyName: (meta?.dummyName as string) ?? '',
      });
    default:
      return item.type;
  }
}
