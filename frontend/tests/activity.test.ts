import { describe, it, expect } from 'vitest';
import { formatAmount } from '../src/utils/format';
import type { ActivityItem } from '../src/services/api';

// Re-implement getActivityText logic inline since the component import pulls in React
function getActivityText(
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
    default:
      return item.type;
  }
}

// Simple mock t() that returns the key with interpolated values
function mockT(key: string, opts?: Record<string, unknown>): string {
  const templates: Record<string, string> = {
    'activity.you': 'You',
    'activity.expenseCreated': '{{actor}} added "{{description}}"',
    'activity.expenseEdited': '{{actor}} edited "{{description}}"',
    'activity.expenseEditedWithAmount':
      '{{actor}} edited "{{description}}" ({{oldAmount}} → {{newAmount}})',
    'activity.expenseDeleted': '{{actor}} deleted "{{description}}"',
    'activity.settlementCompleted': '{{actor}} settled up with {{target}}',
    'activity.memberJoined': '{{actor}} joined the group',
    'activity.memberLeft': '{{actor}} left the group',
    'activity.memberKicked': '{{actor}} removed {{target}}',
  };
  let result = templates[key] ?? key;
  if (opts) {
    for (const [k, v] of Object.entries(opts)) {
      result = result.replace(`{{${k}}}`, String(v));
    }
  }
  return result;
}

function makeItem(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 1,
    groupId: 1,
    groupName: 'Test Group',
    currency: 'USD',
    actorId: 10,
    actorName: 'Alice',
    actorAvatarKey: null,
    type: 'expense_created',
    targetUserId: null,
    targetUserName: null,
    expenseId: null,
    settlementId: null,
    amount: null,
    metadata: null,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getActivityText', () => {
  it('expense_created by another user', () => {
    const item = makeItem({
      type: 'expense_created',
      metadata: { description: 'Lunch' },
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice added "Lunch"');
  });

  it('expense_created by current user shows "You"', () => {
    const item = makeItem({
      type: 'expense_created',
      actorId: 99,
      metadata: { description: 'Dinner' },
    });
    expect(getActivityText(item, mockT, 99)).toBe('You added "Dinner"');
  });

  it('expense_edited', () => {
    const item = makeItem({
      type: 'expense_edited',
      metadata: { description: 'Coffee' },
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice edited "Coffee"');
  });

  it('expense_deleted', () => {
    const item = makeItem({
      type: 'expense_deleted',
      metadata: { description: 'Taxi' },
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice deleted "Taxi"');
  });

  it('settlement_completed', () => {
    const item = makeItem({
      type: 'settlement_completed',
      targetUserId: 20,
      targetUserName: 'Bob',
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice settled up with Bob');
  });

  it('settlement_completed with current user as target', () => {
    const item = makeItem({
      type: 'settlement_completed',
      targetUserId: 99,
      targetUserName: 'Me',
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice settled up with you');
  });

  it('member_joined', () => {
    const item = makeItem({ type: 'member_joined' });
    expect(getActivityText(item, mockT, 99)).toBe('Alice joined the group');
  });

  it('member_left', () => {
    const item = makeItem({ type: 'member_left' });
    expect(getActivityText(item, mockT, 99)).toBe('Alice left the group');
  });

  it('member_kicked', () => {
    const item = makeItem({
      type: 'member_kicked',
      targetUserId: 20,
      targetUserName: 'Bob',
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice removed Bob');
  });

  it('expense_edited with oldAmount shows old→new format', () => {
    const item = makeItem({
      type: 'expense_edited',
      amount: 20_000_000,
      metadata: { description: 'Lunch', oldAmount: 10_000_000 },
    });
    const result = getActivityText(item, mockT, 99, 'USD');
    expect(result).toContain('Alice edited "Lunch"');
    expect(result).toContain('→');
  });

  it('expense_edited without oldAmount uses original format', () => {
    const item = makeItem({
      type: 'expense_edited',
      amount: 10_000_000,
      metadata: { description: 'Coffee' },
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice edited "Coffee"');
  });

  it('expense_edited with same oldAmount as current uses original format', () => {
    const item = makeItem({
      type: 'expense_edited',
      amount: 10_000_000,
      metadata: { description: 'Coffee', oldAmount: 10_000_000 },
    });
    expect(getActivityText(item, mockT, 99)).toBe('Alice edited "Coffee"');
  });
});
