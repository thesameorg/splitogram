import { describe, it, expect } from 'vitest';

// canEditExpense: only the creator (paidBy) can edit
function canEditExpense(currentUserId: number | null, paidBy: number): boolean {
  return currentUserId === paidBy;
}

// canDeleteExpense: creator OR admin can delete
function canDeleteExpense(
  currentUserId: number | null,
  paidBy: number,
  currentUserRole: string | null,
): boolean {
  return currentUserId === paidBy || currentUserRole === 'admin';
}

describe('canEditExpense', () => {
  it('returns true when current user is the creator', () => {
    expect(canEditExpense(1, 1)).toBe(true);
  });

  it('returns false when current user is NOT the creator', () => {
    expect(canEditExpense(2, 1)).toBe(false);
  });

  it('returns false when currentUserId is null', () => {
    expect(canEditExpense(null, 1)).toBe(false);
  });
});

describe('canDeleteExpense', () => {
  it('returns true when current user is the creator (member role)', () => {
    expect(canDeleteExpense(1, 1, 'member')).toBe(true);
  });

  it('returns true when current user is admin but NOT creator', () => {
    expect(canDeleteExpense(2, 1, 'admin')).toBe(true);
  });

  it('returns false when current user is neither creator nor admin', () => {
    expect(canDeleteExpense(2, 1, 'member')).toBe(false);
  });

  it('returns true when current user is both creator AND admin', () => {
    expect(canDeleteExpense(1, 1, 'admin')).toBe(true);
  });

  it('returns false when currentUserId is null', () => {
    expect(canDeleteExpense(null, 1, 'member')).toBe(false);
  });
});
