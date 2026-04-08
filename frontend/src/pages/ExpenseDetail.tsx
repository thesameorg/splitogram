import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type Expense, type GroupDetail, type ExpenseComment } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { resolveCurrentUser } from '../hooks/useCurrentUser';
import { formatAmount } from '../utils/format';
import { timeAgo } from '../utils/time';
import {
  imageUrl,
  validateImageFile,
  processReceipt,
  processReceiptThumbnail,
} from '../utils/image';
import { LoadingScreen } from '../components/LoadingScreen';
import { Avatar } from '../components/Avatar';
import { ImageViewer } from '../components/ImageViewer';
import { hapticImpact } from '../utils/haptic';

export function ExpenseDetail() {
  const { id, expenseId: expenseIdStr } = useParams<{ id: string; expenseId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const groupId = parseInt(id ?? '', 10);
  const expenseId = parseInt(expenseIdStr ?? '', 10);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [comments, setComments] = useState<ExpenseComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [viewImageKey, setViewImageKey] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  const commentsEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useTelegramBackButton(true, `/groups/${groupId}`);

  const loadData = useCallback(async () => {
    if (isNaN(groupId) || isNaN(expenseId)) return;
    try {
      const [groupData, expensesData, commentsData] = await Promise.all([
        api.getGroup(groupId),
        api.listExpenses(groupId),
        api.listComments(groupId, expenseId),
      ]);
      setGroup(groupData);
      const exp = expensesData.expenses.find((e) => e.id === expenseId);
      setExpense(exp ?? null);
      setComments(commentsData.comments);
      setNextCursor(commentsData.nextCursor);

      const user = resolveCurrentUser(groupData.members);
      if (user) {
        setCurrentUserId(user.userId);
        setCurrentUserRole(user.role);
      }
    } catch (err) {
      console.error('Failed to load expense detail:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId, expenseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-scroll to bottom when comments load or new comment added
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) {
      window.Telegram?.WebApp?.showAlert?.(error);
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function clearImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSend() {
    if (sending) return;
    const trimmedText = text.trim();
    if (!trimmedText && !imageFile) return;

    setSending(true);
    hapticImpact('light');

    try {
      let newComment: ExpenseComment;
      if (imageFile) {
        const [processed, thumb] = await Promise.all([
          processReceipt(imageFile),
          processReceiptThumbnail(imageFile),
        ]);
        newComment = await api.createCommentWithImage(
          groupId,
          expenseId,
          processed.blob,
          thumb.blob,
          trimmedText || undefined,
        );
      } else {
        newComment = await api.createComment(groupId, expenseId, trimmedText);
      }
      setComments((prev) => [...prev, newComment]);
      setText('');
      clearImage();
    } catch (err) {
      console.error('Failed to send comment:', err);
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteComment(commentId: number) {
    const confirmed = await new Promise<boolean>((resolve) => {
      const webApp = window.Telegram?.WebApp;
      if (webApp?.showConfirm) {
        webApp.showConfirm(t('comments.deleteConfirm'), (ok: boolean) => resolve(ok));
      } else {
        resolve(window.confirm(t('comments.deleteConfirm')));
      }
    });
    if (!confirmed) return;

    try {
      await api.deleteComment(groupId, expenseId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  }

  async function loadMoreComments() {
    if (!nextCursor) return;
    try {
      const data = await api.listComments(groupId, expenseId, nextCursor);
      setComments((prev) => [...prev, ...data.comments]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load more comments:', err);
    }
  }

  function canDeleteComment(comment: ExpenseComment): boolean {
    if (comment.userId === currentUserId) return true;
    if (currentUserRole === 'admin') return true;
    return false;
  }

  if (loading || !group) return <LoadingScreen />;

  if (!expense) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 text-center bg-tg-bg text-tg-hint">
        {t('comments.expenseNotFound')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-tg-bg text-tg-text">
      {/* Expense info header */}
      <div className="shrink-0 p-4 border-b border-ghost">
        <div className="text-center mb-3">
          <div className="text-2xl font-bold">{formatAmount(expense.amount, group.currency)}</div>
          <div className="text-base font-medium mt-1">{expense.description}</div>
          <div className="text-sm text-tg-hint mt-1">
            {t('group.paidBy', { name: expense.payerName })} &middot; {timeAgo(expense.createdAt)}
          </div>
        </div>

        {/* Split breakdown */}
        <div className="flex flex-wrap gap-1 justify-center">
          {expense.participants.map((p) => (
            <span
              key={p.userId}
              className="text-xs text-tg-hint bg-tg-secondary-bg rounded-full px-2 py-0.5"
            >
              {p.displayName}: {formatAmount(p.shareAmount, group.currency)}
            </span>
          ))}
        </div>

        {/* Comment & receipt */}
        {expense.comment && (
          <div className="text-sm text-tg-hint mt-2 text-center italic">{expense.comment}</div>
        )}
        {expense.receiptThumbKey && (
          <div className="mt-2 flex justify-center">
            <button onClick={() => setViewImageKey(expense.receiptKey)}>
              <img
                src={imageUrl(expense.receiptThumbKey)}
                alt="Receipt"
                className="w-16 h-16 rounded-xl object-cover border border-ghost"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </button>
          </div>
        )}

        {/* Edit / Delete actions */}
        <div className="flex gap-2 mt-3 justify-center">
          {expense.paidBy === currentUserId && (
            <button
              onClick={() => navigate(`/groups/${groupId}/edit-expense/${expenseId}`)}
              className="text-sm text-tg-link font-medium px-3 py-1 rounded-lg border border-ghost"
            >
              {t('group.edit')}
            </button>
          )}
        </div>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {comments.length === 0 && (
          <div className="text-center text-tg-hint text-sm py-8">{t('comments.empty')}</div>
        )}

        {nextCursor && (
          <button
            onClick={loadMoreComments}
            className="w-full text-center text-sm text-tg-link py-2"
          >
            {t('comments.loadMore')}
          </button>
        )}

        {comments.map((comment) => {
          const isOwn = comment.userId === currentUserId;

          return (
            <div key={comment.id} className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
              {!isOwn && (
                <div className="shrink-0 mt-1">
                  <Avatar
                    avatarKey={comment.avatarKey}
                    displayName={comment.displayName}
                    size="sm"
                  />
                </div>
              )}
              <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                {!isOwn && (
                  <div className="text-xs text-tg-hint mb-0.5 px-1">{comment.displayName}</div>
                )}
                <div
                  className={`rounded-2xl px-3 py-2 ${
                    isOwn
                      ? 'bg-tg-button text-tg-button-text rounded-tr-sm'
                      : 'bg-tg-secondary-bg rounded-tl-sm'
                  }`}
                  onClick={() => canDeleteComment(comment) && handleDeleteComment(comment.id)}
                >
                  {comment.imageThumbKey && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewImageKey(comment.imageKey);
                      }}
                      className="mb-1"
                    >
                      <img
                        src={imageUrl(comment.imageThumbKey)}
                        alt=""
                        className="max-w-full rounded-xl"
                        style={{ maxHeight: '200px' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </button>
                  )}
                  {comment.text && (
                    <div className="text-sm whitespace-pre-wrap break-words">{comment.text}</div>
                  )}
                </div>
                <div className="text-[10px] text-tg-hint mt-0.5 px-1">
                  {timeAgo(comment.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={commentsEndRef} />
      </div>

      {/* Image preview */}
      {imagePreview && (
        <div className="shrink-0 px-4 py-2 border-t border-ghost">
          <div className="relative inline-block">
            <img src={imagePreview} alt="" className="h-16 rounded-xl object-cover" />
            <button
              onClick={clearImage}
              className="absolute -top-1 -right-1 w-5 h-5 bg-tg-destructive text-white rounded-full text-xs flex items-center justify-center"
              aria-label="Remove image"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div
        className="shrink-0 border-t border-ghost bg-tg-bg px-3 py-2 flex items-end gap-2"
        style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelect}
          className="hidden"
          aria-label={t('comments.attachImage')}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 p-2 text-tg-hint"
          aria-label={t('comments.attachImage')}
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={t('comments.placeholder')}
          className="flex-1 bg-tg-secondary-bg rounded-full px-4 py-2 text-sm text-tg-text placeholder:text-tg-hint outline-none"
          maxLength={1000}
        />
        <button
          onClick={handleSend}
          disabled={sending || (!text.trim() && !imageFile)}
          className="shrink-0 p-2 text-tg-button disabled:opacity-30"
          aria-label={t('comments.send')}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      {/* Image viewer */}
      <ImageViewer
        imageKey={viewImageKey}
        open={!!viewImageKey}
        onClose={() => setViewImageKey(null)}
      />
    </div>
  );
}
