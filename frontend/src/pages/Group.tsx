import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  api,
  type GroupDetail,
  type Expense,
  type DebtEntry,
  type SettlementListItem,
} from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { resolveCurrentUser } from '../hooks/useCurrentUser';
import { formatAmount } from '../utils/format';
import { timeAgo } from '../utils/time';
import { shareInviteLink } from '../utils/share';
import { mergeTransactions, type TransactionItem } from '../utils/transactions';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';

export function Group() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const groupId = parseInt(id ?? '', 10);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [tab, setTab] = useState<'transactions' | 'balances'>('transactions');
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  useTelegramBackButton(true);

  const loadData = useCallback(async () => {
    if (isNaN(groupId)) return;
    try {
      const [groupData, expensesData, balancesData, settlementsData] = await Promise.all([
        api.getGroup(groupId),
        api.listExpenses(groupId),
        api.getBalances(groupId),
        api.listSettlements(groupId),
      ]);
      setGroup(groupData);
      setTransactions(mergeTransactions(expensesData.expenses, settlementsData.settlements));
      setDebts(balancesData.debts);

      const user = resolveCurrentUser(groupData.members);
      if (user) {
        setCurrentUserId(user.userId);
        setCurrentUserRole(user.role);
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

  function renderSettlementCard(settlement: SettlementListItem) {
    const isFromMe = currentUserId === settlement.fromUser;
    const isToMe = currentUserId === settlement.toUser;

    let label: string;
    if (isFromMe) {
      label = `You paid ${settlement.toUserName}`;
    } else if (isToMe) {
      label = `${settlement.fromUserName} paid you`;
    } else {
      label = `${settlement.fromUserName} paid ${settlement.toUserName}`;
    }

    return (
      <div
        key={`s-${settlement.id}`}
        className="bg-green-50 dark:bg-green-900/10 p-4 rounded-xl border border-green-200 dark:border-green-800"
      >
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <span className="text-green-600 dark:text-green-400 text-lg">&#10003;</span>
            <div>
              <div className="font-medium text-green-800 dark:text-green-300">{label}</div>
              <div className="text-sm text-gray-500">{timeAgo(settlement.createdAt)}</div>
            </div>
          </div>
          <div className="font-medium text-green-700 dark:text-green-400">
            {formatAmount(settlement.amount, group?.currency)}
          </div>
        </div>
        {settlement.comment && (
          <div className="mt-2 text-sm text-gray-500 italic">{settlement.comment}</div>
        )}
      </div>
    );
  }

  function renderExpenseCard(exp: Expense) {
    return (
      <div
        key={`e-${exp.id}`}
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
            Split among {exp.participants.length}:{' '}
            {exp.participants.map((p) => p.displayName).join(', ')}
          </div>
          {canModifyExpense(exp) && (
            <div className="flex gap-2 ml-2 shrink-0">
              <button
                onClick={() => navigate(`/groups/${groupId}/edit-expense/${exp.id}`)}
                className="text-xs text-blue-500"
              >
                Edit
              </button>
              <button onClick={() => handleDeleteExpense(exp.id)} className="text-xs text-red-500">
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading || !group) return <LoadingScreen />;

  return (
    <PageLayout>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">{group.name}</h1>
            <div className="text-sm text-gray-500">
              {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => shareInviteLink(group.inviteCode, group.name)}
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

        {/* Member list */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {group.members.map((m) => (
            <div
              key={m.userId}
              className="bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full text-sm flex items-center gap-1"
            >
              {m.role === 'admin' && <span title="Admin">&#9812;</span>}
              {m.displayName}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
        <button
          onClick={() => setTab('transactions')}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 ${
            tab === 'transactions'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-gray-500'
          }`}
        >
          Transactions
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
      {tab === 'transactions' ? (
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No transactions yet</p>
          ) : (
            transactions.map((t) =>
              t.type === 'expense' ? renderExpenseCard(t.data) : renderSettlementCard(t.data),
            )
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
                  <div className="font-medium text-red-500">
                    {formatAmount(debt.amount, group?.currency)}
                  </div>
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
        className="fixed bottom-20 right-6 bg-blue-500 text-white px-6 py-3 rounded-full shadow-lg font-medium"
      >
        + Add Expense
      </button>
    </PageLayout>
  );
}
