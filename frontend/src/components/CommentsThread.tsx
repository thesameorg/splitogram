import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ExpenseComment } from '../services/api';
import { timeAgo } from '../utils/time';
import {
  imageUrl,
  validateImageFile,
  processReceipt,
  processReceiptThumbnail,
} from '../utils/image';
import { Avatar } from './Avatar';
import { ImageViewer } from './ImageViewer';
import { hapticImpact } from '../utils/haptic';

export interface CommentsState {
  comments: ExpenseComment[];
  nextCursor: string | null;
  loading: boolean;
  loadMore: () => Promise<void>;
  append: (c: ExpenseComment) => void;
  remove: (id: number) => void;
}

export function useComments(groupId: number, expenseId: number): CommentsState {
  const [comments, setComments] = useState<ExpenseComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listComments(groupId, expenseId)
      .then((data) => {
        if (cancelled) return;
        setComments(data.comments);
        setNextCursor(data.nextCursor);
      })
      .catch((err) => console.error('Failed to load comments:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, expenseId]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const data = await api.listComments(groupId, expenseId, nextCursor);
      setComments((prev) => [...prev, ...data.comments]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load more comments:', err);
    }
  }, [groupId, expenseId, nextCursor]);

  const append = useCallback((c: ExpenseComment) => {
    setComments((prev) => [...prev, c]);
  }, []);

  const remove = useCallback((id: number) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { comments, nextCursor, loading, loadMore, append, remove };
}

export function CommentsList({
  state,
  groupId,
  expenseId,
  currentUserId,
  currentUserRole,
}: {
  state: CommentsState;
  groupId: number;
  expenseId: number;
  currentUserId: number | null;
  currentUserRole: string | null;
}) {
  const { t } = useTranslation();
  const [viewImageKey, setViewImageKey] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.comments]);

  async function handleDelete(commentId: number) {
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
      state.remove(commentId);
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  }

  function canDelete(comment: ExpenseComment): boolean {
    return comment.userId === currentUserId || currentUserRole === 'admin';
  }

  if (state.loading) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 border-2 border-tg-hint/30 border-t-tg-hint rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state.nextCursor && (
        <button onClick={state.loadMore} className="w-full text-center text-sm text-tg-link py-2">
          {t('comments.loadMore')}
        </button>
      )}

      {state.comments.length === 0 && (
        <div className="text-center text-tg-hint text-sm py-4">{t('comments.empty')}</div>
      )}

      {state.comments.map((comment) => {
        const isOwn = comment.userId === currentUserId;
        return (
          <div key={comment.id} className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
            {!isOwn && (
              <div className="shrink-0 mt-1">
                <Avatar avatarKey={comment.avatarKey} displayName={comment.displayName} size="sm" />
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
                onClick={() => canDelete(comment) && handleDelete(comment.id)}
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
      <div ref={endRef} />

      <ImageViewer
        imageKey={viewImageKey}
        open={!!viewImageKey}
        onClose={() => setViewImageKey(null)}
      />
    </div>
  );
}

export function CommentsInput({
  groupId,
  expenseId,
  onSent,
}: {
  groupId: number;
  expenseId: number;
  onSent: (comment: ExpenseComment) => void;
}) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      onSent(newComment);
      setText('');
      clearImage();
    } catch (err) {
      console.error('Failed to send comment:', err);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {imagePreview && (
        <div className="px-4 pt-2">
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
      <div className="px-3 py-2 flex items-end gap-2">
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
    </>
  );
}
