import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type GroupDetail, type SplitMode } from '../services/api';
import { formatAmount } from '../utils/format';
import {
  validateImageFile,
  processReceipt,
  processReceiptThumbnail,
  imageUrl,
} from '../utils/image';
import { sanitizeDecimalInput } from '../utils/input';
import { resolveCurrentUser } from '../hooks/useCurrentUser';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { useTelegramMainButton } from '../hooks/useTelegramMainButton';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';

export function AddExpense() {
  const { id, expenseId: expenseIdParam } = useParams<{ id: string; expenseId?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const groupId = parseInt(id ?? '', 10);
  const expenseId = expenseIdParam ? parseInt(expenseIdParam, 10) : null;
  const isEditMode = expenseId !== null;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [paidBy, setPaidBy] = useState<number | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<number>>(new Set());
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [shares, setShares] = useState<Map<number, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [existingReceipt, setExistingReceipt] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useTelegramBackButton(true);

  useEffect(() => {
    if (isNaN(groupId)) return;

    const loadGroup = api.getGroup(groupId);

    if (isEditMode && expenseId) {
      Promise.all([loadGroup, api.listExpenses(groupId)]).then(([groupData, expensesData]) => {
        setGroup(groupData);
        const expense = expensesData.expenses.find((e) => e.id === expenseId);
        if (expense) {
          setDescription(expense.description);
          setComment(expense.comment || '');
          setAmountStr((expense.amount / 1_000_000).toString());
          setPaidBy(expense.paidBy);
          setSelectedParticipants(new Set(expense.participants.map((p) => p.userId)));
          setSplitMode(expense.splitMode ?? 'equal');
          if (expense.splitMode === 'percentage') {
            const m = new Map<number, string>();
            for (const p of expense.participants) {
              const pct = ((p.shareAmount / expense.amount) * 100).toFixed(2).replace(/\.?0+$/, '');
              m.set(p.userId, pct);
            }
            setShares(m);
          } else if (expense.splitMode === 'manual') {
            const m = new Map<number, string>();
            for (const p of expense.participants) {
              m.set(p.userId, (p.shareAmount / 1_000_000).toString());
            }
            setShares(m);
          }
          if (expense.receiptThumbKey) {
            setReceiptPreview(imageUrl(expense.receiptThumbKey));
            setExistingReceipt(true);
          }
        }
      });
    } else {
      loadGroup.then((data) => {
        setGroup(data);
        const allIds = new Set(data.members.map((m) => m.userId));
        setSelectedParticipants(allIds);

        const user = resolveCurrentUser(data.members);
        if (user) setPaidBy(user.userId);
      });
    }
  }, [groupId, expenseId, isEditMode]);

  const amount = parseFloat(amountStr);
  const amountMicro = isNaN(amount) ? 0 : Math.round(amount * 1_000_000);
  const perPerson = selectedParticipants.size > 0 ? amountMicro / selectedParticipants.size : 0;

  // Validation for percentage/manual modes
  const sharesTotal =
    splitMode === 'percentage'
      ? Array.from(shares.values()).reduce((s, v) => s + (parseFloat(v) || 0), 0)
      : splitMode === 'manual'
        ? Array.from(shares.values()).reduce(
            (s, v) => s + Math.round((parseFloat(v) || 0) * 1_000_000),
            0,
          )
        : 0;
  const sharesValid =
    splitMode === 'equal'
      ? true
      : splitMode === 'percentage'
        ? Math.abs(sharesTotal - 100) < 0.01 && shares.size === selectedParticipants.size
        : sharesTotal === amountMicro && shares.size === selectedParticipants.size;

  const canSubmit =
    description.trim() &&
    amountMicro > 0 &&
    selectedParticipants.size >= 1 &&
    paidBy !== null &&
    sharesValid;

  const handleSubmit = useCallback(async () => {
    setAttempted(true);
    if (!canSubmit || submitting || paidBy === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const sharesPayload =
        splitMode === 'percentage'
          ? Array.from(selectedParticipants).map((uid) => ({
              userId: uid,
              value: parseFloat(shares.get(uid) || '0'),
            }))
          : splitMode === 'manual'
            ? Array.from(selectedParticipants).map((uid) => ({
                userId: uid,
                value: Math.round(parseFloat(shares.get(uid) || '0') * 1_000_000),
              }))
            : undefined;

      if (isEditMode && expenseId) {
        await api.editExpense(groupId, expenseId, {
          amount: amountMicro,
          description: description.trim(),
          comment: comment.trim() || null,
          participantIds: Array.from(selectedParticipants),
          splitMode,
          shares: sharesPayload,
        });
        // Upload receipt if new file selected in edit mode
        if (receiptFile) {
          const [processed, thumb] = await Promise.all([
            processReceipt(receiptFile),
            processReceiptThumbnail(receiptFile),
          ]);
          await api.uploadReceipt(groupId, expenseId, processed.blob, thumb.blob);
        } else if (!receiptPreview && !existingReceipt) {
          // User removed existing receipt without adding a new one
          await api.deleteReceipt(groupId, expenseId).catch(() => {});
        }
      } else {
        const result = await api.createExpense(groupId, {
          amount: amountMicro,
          description: description.trim(),
          comment: comment.trim() || undefined,
          paidBy,
          participantIds: Array.from(selectedParticipants),
          splitMode,
          shares: sharesPayload,
        });
        // Upload receipt after expense is created
        if (receiptFile) {
          const [processed, thumb] = await Promise.all([
            processReceipt(receiptFile),
            processReceiptThumbnail(receiptFile),
          ]);
          await api.uploadReceipt(groupId, result.id, processed.blob, thumb.blob);
        }
      }
      navigate(`/groups/${groupId}`, { replace: true });
    } catch (err: any) {
      setError(err.message || `Failed to ${isEditMode ? 'update' : 'add'} expense`);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    submitting,
    paidBy,
    groupId,
    expenseId,
    isEditMode,
    amountMicro,
    description,
    comment,
    selectedParticipants,
    splitMode,
    shares,
    receiptFile,
    navigate,
  ]);

  useTelegramMainButton({
    text: isEditMode ? t('addExpense.save') : t('addExpense.submit'),
    onClick: handleSubmit,
    disabled: !canSubmit,
    loading: submitting,
    show: true,
  });

  function toggleParticipant(userId: number) {
    setSelectedParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  function handleReceiptSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setReceiptFile(file);
    setExistingReceipt(false);
    // Create preview URL
    const url = URL.createObjectURL(file);
    setReceiptPreview(url);
  }

  function handleRemoveReceipt() {
    if (!confirm(t('addExpense.removeReceiptConfirm'))) return;
    setReceiptFile(null);
    if (receiptPreview && !existingReceipt) {
      URL.revokeObjectURL(receiptPreview);
    }
    setReceiptPreview(null);
    setExistingReceipt(false);
  }

  if (!group) return <LoadingScreen />;

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">
        {isEditMode ? t('addExpense.editTitle') : t('addExpense.title')}
      </h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Description */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('addExpense.description')}
        </label>
        <input
          type="text"
          placeholder={t('addExpense.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`w-full p-3 border rounded-xl ${attempted && !description.trim() ? 'border-app-negative bg-app-card-nested' : 'border-ghost bg-app-card-nested'}`}
          autoFocus
          maxLength={500}
        />
        {attempted && !description.trim() && (
          <p className="text-xs text-app-negative mt-1">{t('addExpense.descriptionRequired')}</p>
        )}
      </div>

      {/* Comment (optional note) */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('addExpense.note')}
        </label>
        <textarea
          placeholder={t('addExpense.notePlaceholder')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full p-3 border border-ghost rounded-xl bg-app-card-nested text-sm resize-none"
          rows={2}
          maxLength={1000}
        />
      </div>

      {/* Amount + Paid By — side by side */}
      <div className="mb-4 flex gap-3">
        <div className="w-[35%] min-w-0">
          <label className="block text-sm font-medium mb-1 text-tg-hint">
            {t('addExpense.amountWithCurrency', { currency: group.currency })}
          </label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amountStr}
            onChange={(e) => setAmountStr(sanitizeDecimalInput(e.target.value))}
            className="w-full px-3 py-2 border border-ghost rounded-xl bg-app-card-nested text-2xl"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium mb-1 text-tg-hint">
            {t('addExpense.paidBy')}
          </label>
          <select
            value={paidBy ?? ''}
            onChange={(e) => setPaidBy(parseInt(e.target.value, 10))}
            className="w-full p-3 border border-ghost rounded-xl bg-app-card-nested text-2xl"
            disabled={isEditMode}
          >
            {group.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.isDummy ? `\uD83D\uDC7B ${m.displayName}` : m.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
      {splitMode === 'equal' && selectedParticipants.size > 0 && amountMicro > 0 && (
        <div className="text-sm text-tg-hint -mt-3 mb-4">
          {t('addExpense.perPerson', {
            amount: formatAmount(perPerson, group.currency),
            count: selectedParticipants.size,
          })}
        </div>
      )}

      {/* Split Among */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-tg-hint">
            {t('addExpense.splitAmong')}
          </label>
          <div className="flex gap-2">
            {selectedParticipants.size < group.members.length && (
              <button
                onClick={() => setSelectedParticipants(new Set(group.members.map((m) => m.userId)))}
                className="text-xs text-tg-link font-medium"
              >
                {t('addExpense.selectAll')}
              </button>
            )}
            {selectedParticipants.size > 0 && (
              <button
                onClick={() => setSelectedParticipants(new Set())}
                className="text-xs text-app-negative font-medium"
              >
                {t('addExpense.deselectAll')}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {group.members.map((m) => (
            <button
              key={m.userId}
              onClick={() => toggleParticipant(m.userId)}
              className={`px-4 py-2 rounded-full text-sm font-medium border ${
                selectedParticipants.has(m.userId)
                  ? 'bg-tg-button text-tg-button-text border-tg-link'
                  : 'bg-transparent text-tg-hint border-ghost'
              }`}
            >
              {m.isDummy ? `\uD83D\uDC7B ${m.displayName}` : m.displayName}
            </button>
          ))}
        </div>
      </div>

      {/* Split Mode Toggle */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2 text-tg-hint">
          {t('addExpense.splitMode')}
        </label>
        <div className="flex rounded-xl border border-ghost overflow-hidden">
          {(['equal', 'percentage', 'manual'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setSplitMode(mode);
                setShares(new Map());
              }}
              className={`flex-1 py-2 text-sm font-medium ${
                splitMode === mode
                  ? 'bg-tg-button text-tg-button-text'
                  : 'bg-transparent text-tg-hint'
              }`}
            >
              {t(`addExpense.split${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Per-participant inputs for percentage/manual */}
      {splitMode === 'percentage' && selectedParticipants.size > 0 && (
        <div className="mb-4 space-y-2">
          {group.members
            .filter((m) => selectedParticipants.has(m.userId))
            .map((m) => {
              const pctVal = parseFloat(shares.get(m.userId) || '0') || 0;
              const calcAmount = amountMicro > 0 ? Math.round((pctVal / 100) * amountMicro) : 0;
              return (
                <div key={m.userId} className="flex items-center gap-2">
                  <span className="text-sm flex-1 truncate">{m.displayName}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={shares.get(m.userId) || ''}
                    onChange={(e) =>
                      setShares((prev) =>
                        new Map(prev).set(m.userId, sanitizeDecimalInput(e.target.value)),
                      )
                    }
                    className="w-20 p-2 border border-ghost rounded-lg bg-app-card-nested text-right text-sm"
                  />
                  <span className="text-sm text-tg-hint w-6">%</span>
                  {calcAmount > 0 && (
                    <span className="text-xs text-tg-hint w-20 text-right">
                      {formatAmount(calcAmount, group.currency)}
                    </span>
                  )}
                </div>
              );
            })}
          <div
            className={`text-xs text-right ${Math.abs(sharesTotal - 100) < 0.01 ? 'text-app-positive' : 'text-app-negative'}`}
          >
            {t('addExpense.totalPercent', { total: sharesTotal.toFixed(1) })}
          </div>
        </div>
      )}

      {splitMode === 'manual' && selectedParticipants.size > 0 && amountMicro > 0 && (
        <div className="mb-4 space-y-2">
          {group.members
            .filter((m) => selectedParticipants.has(m.userId))
            .map((m) => (
              <div key={m.userId} className="flex items-center gap-2">
                <span className="text-sm flex-1 truncate">{m.displayName}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={shares.get(m.userId) || ''}
                  onChange={(e) =>
                    setShares((prev) =>
                      new Map(prev).set(m.userId, sanitizeDecimalInput(e.target.value)),
                    )
                  }
                  className="w-28 p-2 border border-ghost rounded-lg bg-app-card-nested text-right text-sm"
                />
                <span className="text-sm text-tg-hint w-10">{group.currency}</span>
              </div>
            ))}
          <div
            className={`text-xs text-right ${sharesTotal === amountMicro ? 'text-app-positive' : 'text-app-negative'}`}
          >
            {t('addExpense.remaining', {
              amount: formatAmount(amountMicro - sharesTotal, group.currency),
            })}
          </div>
        </div>
      )}

      {/* Receipt attachment */}
      <div className="mb-4">
        {receiptPreview ? (
          <div className="flex items-center gap-3 p-3 card rounded-2xl">
            <img src={receiptPreview} alt="Receipt" className="w-12 h-12 rounded-lg object-cover" />
            <span className="flex-1 text-sm font-medium">{t('addExpense.receiptAttached')}</span>
            <button
              onClick={handleRemoveReceipt}
              className="text-tg-destructive text-sm font-medium"
            >
              {t('addExpense.removeReceipt')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full p-3 border border-dashed border-ghost rounded-xl text-sm text-tg-hint"
          >
            {t('addExpense.attachReceipt')}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleReceiptSelect}
          className="hidden"
          aria-label={t('addExpense.attachReceipt')}
        />
      </div>

      {/* Submit button (fallback for non-TG env) */}
      {!window.Telegram?.WebApp && (
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="w-full mt-6 bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white py-3 rounded-xl font-medium disabled:opacity-50"
        >
          {submitting
            ? t('addExpense.saving')
            : isEditMode
              ? t('addExpense.save')
              : t('addExpense.submit')}
        </button>
      )}
    </PageLayout>
  );
}
