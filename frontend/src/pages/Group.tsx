import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type GroupDetail, type Expense, type DebtEntry } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { config } from '../config';
import { formatAmount } from '../utils/format';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Group() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const groupId = parseInt(id ?? '', 10);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [tab, setTab] = useState<'expenses' | 'balances'>('expenses');
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  useTelegramBackButton(true);

  const loadData = useCallback(async () => {
    if (isNaN(groupId)) return;
    try {
      const [groupData, expensesData, balancesData] = await Promise.all([
        api.getGroup(groupId),
        api.listExpenses(groupId),
        api.getBalances(groupId),
      ]);
      setGroup(groupData);
      setExpenses(expensesData.expenses);
      setDebts(balancesData.debts);

      // Determine current user ID from group members
      // The dev user's telegram ID is used to find the current user
      const webApp = window.Telegram?.WebApp;
      const tgId = webApp?.initDataUnsafe?.user?.id;
      if (tgId) {
        const member = groupData.members.find((m) => m.telegramId === tgId);
        if (member) {
          setCurrentUserId(member.userId);
          setCurrentUserRole(member.role);
        }
      } else {
        // Dev mode — assume first admin is current user
        const admin = groupData.members.find((m) => m.role === 'admin');
        if (admin) {
          setCurrentUserId(admin.userId);
          setCurrentUserRole(admin.role);
        }
      }
    } catch (err) {
      console.error('Failed to load group:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleShareInvite() {
    if (!group) return;
    const botUsername = config.telegramBotUsername;
    const link = botUsername
      ? `https://t.me/${botUsername}?start=join_${group.inviteCode}`
      : `Invite code: ${group.inviteCode}`;

    const webApp = window.Telegram?.WebApp;
    if (webApp?.openTelegramLink) {
      // Use Telegram share dialog
      const text = encodeURIComponent(`Join "${group.name}" on Splitogram! ${link}`);
      webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
    } else {
      navigator.clipboard.writeText(link);
      alert('Invite link copied!');
    }
  }

  function canModifyExpense(exp: Expense): boolean {
    return currentUserId === exp.paidBy || currentUserRole === 'admin';
  }

  async function handleDeleteExpense(expenseId: number) {
    if (!confirm('Delete this expense? Balances will be recalculated.')) return;
    try {
      await api.deleteExpense(groupId, expenseId);
      loadData();
    } catch (err) {
      console.error('Failed to delete expense:', err);
    }
  }

  async function handleSettleUp(debt: DebtEntry) {
    try {
      const result = await api.createSettlement(groupId, debt.from.userId, debt.to.userId);
      navigate(`/settle/${result.settlement.id}`);
    } catch (err) {
      console.error('Failed to create settlement:', err);
    }
  }

  if (loading || !group) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">{group.name}</h1>
            <div className="text-sm text-gray-500">{group.members.length} {group.members.length === 1 ? 'member' : 'members'}</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleShareInvite}
              className="text-blue-500 text-sm font-medium px-3 py-1 border border-blue-500 rounded-lg"
            >
              Invite
            </button>
            <button
              onClick={() => navigate(`/groups/${groupId}/settings`)}
              className="text-gray-500 text-sm font-medium px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Settings
            </button>
          </div>
        </div>

        {/* Member avatars */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {group.members.map((m) => (
            <div
              key={m.userId}
              className="bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full text-sm flex items-center gap-1"
            >
              {m.role === 'admin' && <span title="Creator">*</span>}
              {m.displayName}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
        <button
          onClick={() => setTab('expenses')}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 ${
            tab === 'expenses'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-gray-500'
          }`}
        >
          Expenses
        </button>
        <button
          onClick={() => setTab('balances')}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 ${
            tab === 'balances'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-gray-500'
          }`}
        >
          Balances
        </button>
      </div>

      {/* Content */}
      {tab === 'expenses' ? (
        <div className="space-y-3">
          {expenses.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No expenses yet</p>
          ) : (
            expenses.map((exp) => (
              <div
                key={exp.id}
                className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{exp.description}</div>
                    <div className="text-sm text-gray-500">
                      Paid by {exp.payerName} &middot; {timeAgo(exp.createdAt)}
                    </div>
                  </div>
                  <div className="font-medium">{formatAmount(exp.amount, group?.currency)}</div>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <div className="text-xs text-gray-400">
                    Split among {exp.participants.length}: {exp.participants.map((p) => p.displayName).join(', ')}
                  </div>
                  {canModifyExpense(exp) && (
                    <div className="flex gap-2 ml-2 shrink-0">
                      <button
                        onClick={() => navigate(`/groups/${groupId}/edit-expense/${exp.id}`)}
                        className="text-xs text-blue-500"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteExpense(exp.id)}
                        className="text-xs text-red-500"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {debts.length === 0 ? (
            <p className="text-center text-gray-500 py-8">All settled up!</p>
          ) : (
            debts.map((debt, i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-medium">
                      {currentUserId === debt.from.userId ? 'You' : debt.from.displayName}
                    </span>
                    <span className="text-gray-500">
                      {currentUserId === debt.from.userId ? ' owe ' : ' owes '}
                    </span>
                    <span className="font-medium">
                      {currentUserId === debt.to.userId ? 'you' : debt.to.displayName}
                    </span>
                  </div>
                  <div className="font-medium text-red-500">{formatAmount(debt.amount, group?.currency)}</div>
                </div>
                {currentUserId === debt.from.userId && (
                  <button
                    onClick={() => handleSettleUp(debt)}
                    className="mt-3 w-full bg-blue-500 text-white py-2 rounded-lg text-sm font-medium"
                  >
                    Settle Up
                  </button>
                )}
                {currentUserId === debt.to.userId && (
                  <button
                    onClick={() => handleSettleUp(debt)}
                    className="mt-3 w-full text-gray-500 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-600"
                  >
                    Mark as Settled
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Add Expense FAB */}
      <button
        onClick={() => navigate(`/groups/${groupId}/add-expense`)}
        className="fixed bottom-6 right-6 bg-blue-500 text-white px-6 py-3 rounded-full shadow-lg font-medium"
      >
        + Add Expense
      </button>
    </div>
  );
}
