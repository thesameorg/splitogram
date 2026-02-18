import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type GroupDetail } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { useTelegramMainButton } from '../hooks/useTelegramMainButton';

export function AddExpense() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const groupId = parseInt(id ?? '', 10);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [paidBy, setPaidBy] = useState<number | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useTelegramBackButton(true);

  useEffect(() => {
    if (isNaN(groupId)) return;
    api.getGroup(groupId).then((data) => {
      setGroup(data);
      // Default: all members selected, current user pays
      const allIds = new Set(data.members.map((m) => m.userId));
      setSelectedParticipants(allIds);

      // Determine current user
      const webApp = window.Telegram?.WebApp;
      const tgId = webApp?.initDataUnsafe?.user?.id;
      if (tgId) {
        const member = data.members.find((m) => m.telegramId === tgId);
        if (member) setPaidBy(member.userId);
      } else {
        const admin = data.members.find((m) => m.role === 'admin');
        if (admin) setPaidBy(admin.userId);
      }
    });
  }, [groupId]);

  const amount = parseFloat(amountStr);
  const amountMicro = isNaN(amount) ? 0 : Math.round(amount * 1_000_000);
  const perPerson = selectedParticipants.size > 0 ? amountMicro / selectedParticipants.size : 0;
  const canSubmit = description.trim() && amountMicro > 0 && selectedParticipants.size >= 2 && paidBy !== null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting || paidBy === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createExpense(groupId, {
        amount: amountMicro,
        description: description.trim(),
        paidBy,
        participantIds: Array.from(selectedParticipants),
      });
      navigate(`/groups/${groupId}`, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to add expense');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, paidBy, groupId, amountMicro, description, selectedParticipants, navigate]);

  useTelegramMainButton({
    text: 'Add Expense',
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

  if (!group) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-6">Add Expense</h1>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Description */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Description
        </label>
        <input
          type="text"
          placeholder="What was it for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-transparent"
          autoFocus
        />
      </div>

      {/* Amount */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Amount (USDT)
        </label>
        <input
          type="number"
          placeholder="0.00"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-transparent text-2xl"
          min="0"
          step="0.01"
          inputMode="decimal"
        />
      </div>

      {/* Paid By */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Paid by
        </label>
        <select
          value={paidBy ?? ''}
          onChange={(e) => setPaidBy(parseInt(e.target.value, 10))}
          className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-transparent"
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
        <label className="block text-sm font-medium mb-2 text-gray-600 dark:text-gray-400">
          Split among
        </label>
        <div className="flex flex-wrap gap-2">
          {group.members.map((m) => (
            <button
              key={m.userId}
              onClick={() => toggleParticipant(m.userId)}
              className={`px-4 py-2 rounded-full text-sm font-medium border ${
                selectedParticipants.has(m.userId)
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-transparent text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'
              }`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      </div>

      {/* Per-person amount */}
      {selectedParticipants.size > 0 && amountMicro > 0 && (
        <div className="text-center text-sm text-gray-500 mt-6">
          ${(perPerson / 1_000_000).toFixed(2)} per person ({selectedParticipants.size} people)
        </div>
      )}

      {/* Submit button (fallback for non-TG env) */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="w-full mt-6 bg-blue-500 text-white py-3 rounded-xl font-medium disabled:opacity-50"
      >
        {submitting ? 'Adding...' : 'Add Expense'}
      </button>
    </div>
  );
}
