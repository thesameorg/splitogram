import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type GroupDetail } from '../services/api';
import { formatAmount } from '../utils/format';
import {
  validateImageFile,
  processReceipt,
  processReceiptThumbnail,
  imageUrl,
} from '../utils/image';
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
  const [amountStr, setAmountStr] = useState('');
  const [paidBy, setPaidBy] = useState<number | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [existingReceipt, setExistingReceipt] = useState(false);
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
          setAmountStr((expense.amount / 1_000_000).toString());
          setPaidBy(expense.paidBy);
          setSelectedParticipants(new Set(expense.participants.map((p) => p.userId)));
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
  const canSubmit =
    description.trim() && amountMicro > 0 && selectedParticipants.size >= 2 && paidBy !== null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting || paidBy === null) return;
    setSubmitting(true);
    setError(null);
    try {
      if (isEditMode && expenseId) {
        await api.editExpense(groupId, expenseId, {
          amount: amountMicro,
          description: description.trim(),
          participantIds: Array.from(selectedParticipants),
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
          paidBy,
          participantIds: Array.from(selectedParticipants),
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
    selectedParticipants,
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
          className="w-full p-3 border border-tg-separator rounded-xl bg-transparent"
          autoFocus
          maxLength={500}
        />
      </div>

      {/* Amount — A4: show currency in label */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('addExpense.amountWithCurrency', { currency: group.currency })}
        </label>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className="w-full p-3 border border-tg-separator rounded-xl bg-transparent text-2xl"
        />
      </div>

      {/* Paid By */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('addExpense.paidBy')}
        </label>
        <select
          value={paidBy ?? ''}
          onChange={(e) => setPaidBy(parseInt(e.target.value, 10))}
          className="w-full p-3 border border-tg-separator rounded-xl bg-transparent"
          disabled={isEditMode}
        >
          {group.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Split Among */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2 text-tg-hint">
          {t('addExpense.splitAmong')}
        </label>
        <div className="flex flex-wrap gap-2">
          {group.members.map((m) => (
            <button
              key={m.userId}
              onClick={() => toggleParticipant(m.userId)}
              className={`px-4 py-2 rounded-full text-sm font-medium border ${
                selectedParticipants.has(m.userId)
                  ? 'bg-tg-button text-tg-button-text border-tg-button'
                  : 'bg-transparent text-tg-hint border-tg-separator'
              }`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      </div>

      {/* Receipt attachment */}
      <div className="mb-4">
        {receiptPreview ? (
          <div className="flex items-center gap-3 p-3 bg-tg-section rounded-xl border border-tg-separator">
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
            className="w-full p-3 border border-dashed border-tg-separator rounded-xl text-sm text-tg-hint"
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
        />
      </div>

      {/* Per-person amount */}
      {selectedParticipants.size > 0 && amountMicro > 0 && (
        <div className="text-center text-sm text-tg-hint mt-6">
          {t('addExpense.perPerson', {
            amount: formatAmount(perPerson, group.currency),
            count: selectedParticipants.size,
          })}
        </div>
      )}

      {/* Submit button (fallback for non-TG env) */}
      {!window.Telegram?.WebApp && (
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="w-full mt-6 bg-tg-button text-tg-button-text py-3 rounded-xl font-medium disabled:opacity-50"
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
