import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Expense, GroupDetail } from '../services/api';
import { formatAmount } from '../utils/format';
import { timeAgo } from '../utils/time';
import { imageUrl } from '../utils/image';
import { BottomSheet } from './BottomSheet';
import { CommentsInput, CommentsList, useComments } from './CommentsThread';

interface Props {
  expense: Expense;
  group: GroupDetail;
  currentUserId: number | null;
  currentUserRole: string | null;
  onClose: () => void;
  onViewReceipt: (imageKey: string) => void;
  onDelete: (expenseId: number) => void;
  onCommentCountChange: (expenseId: number, count: number) => void;
}

export function ExpenseDetailSheet({
  expense,
  group,
  currentUserId,
  currentUserRole,
  onClose,
  onViewReceipt,
  onDelete,
  onCommentCountChange,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const comments = useComments(group.id, expense.id);

  const canEdit = currentUserId === expense.paidBy;
  const canDelete = canEdit || currentUserRole === 'admin';

  return (
    <BottomSheet
      open={true}
      onClose={onClose}
      title={expense.description}
      footer={
        <CommentsInput
          groupId={group.id}
          expenseId={expense.id}
          onSent={(c) => {
            comments.append(c);
            onCommentCountChange(expense.id, comments.comments.length + 1);
          }}
        />
      }
    >
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-3xl font-bold">{formatAmount(expense.amount, group.currency)}</div>
          <div className="text-sm text-tg-hint mt-1">
            {t('group.paidBy', { name: expense.payerName })}
          </div>
          {expense.splitMode && expense.splitMode !== 'equal' && (
            <div className="text-xs text-tg-hint mt-1">
              {t(
                `addExpense.split${expense.splitMode.charAt(0).toUpperCase() + expense.splitMode.slice(1)}`,
              )}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-tg-hint uppercase tracking-label mb-2">
            {t('group.splitAmong', { count: expense.participants.length })}
          </div>
          <div className="space-y-1">
            {expense.participants.map((p) => (
              <div
                key={p.userId}
                className="flex justify-between items-center py-1.5 px-2 rounded-lg"
              >
                <span className="text-sm">{p.displayName}</span>
                <span className="text-sm font-medium">
                  {formatAmount(p.shareAmount, group.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {expense.comment && (
          <div className="text-sm text-tg-text card rounded-xl px-3 py-2">{expense.comment}</div>
        )}

        {expense.receiptThumbKey && expense.receiptKey && (
          <div className="flex justify-center">
            <button
              onClick={() => {
                onViewReceipt(expense.receiptKey!);
              }}
            >
              <img
                src={imageUrl(expense.receiptThumbKey)}
                alt="Receipt"
                className="w-20 h-20 rounded-xl object-cover border border-ghost"
              />
            </button>
          </div>
        )}

        <div className="text-xs text-tg-hint text-center">{timeAgo(expense.createdAt)}</div>

        {(canEdit || canDelete) && (
          <div className="flex gap-3">
            {canEdit && (
              <button
                onClick={() => {
                  onClose();
                  navigate(`/groups/${group.id}/edit-expense/${expense.id}`);
                }}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-tg-link border border-ghost"
              >
                {t('group.edit')}
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => {
                  onClose();
                  onDelete(expense.id);
                }}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-tg-destructive border border-tg-destructive"
              >
                {t('group.delete')}
              </button>
            )}
          </div>
        )}

        <div className="border-t border-ghost pt-3">
          <div className="text-xs font-medium text-tg-hint uppercase tracking-label mb-2">
            {t('comments.title')}
          </div>
          <CommentsList
            state={comments}
            groupId={group.id}
            expenseId={expense.id}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
        </div>
      </div>
    </BottomSheet>
  );
}
