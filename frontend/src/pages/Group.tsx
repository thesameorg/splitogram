import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    if (!confirm(t('group.deleteConfirm'))) return;
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
      label = t('group.youPaid', { name: settlement.toUserName });
    } else if (isToMe) {
      label = t('group.paidYou', { name: settlement.fromUserName });
    } else {
      label = t('group.paid', { from: settlement.fromUserName, to: settlement.toUserName });
    }

    // A3: Settlement amount color — red if you paid, green if paid to you
    const amountColor = isFromMe ? 'text-app-negative' : 'text-app-positive';

    return (
      <div
        key={`s-${settlement.id}`}
        className="bg-app-positive-bg p-4 rounded-xl border border-app-positive/20"
      >
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <span className="text-app-positive text-lg">&#10003;</span>
            <div>
              <div className="font-medium text-app-positive">{label}</div>
              <div className="text-sm text-tg-hint">{timeAgo(settlement.createdAt)}</div>
            </div>
          </div>
          <div className={`font-medium ${amountColor}`}>
            {formatAmount(settlement.amount, group?.currency)}
          </div>
        </div>
        {settlement.comment && (
          <div className="mt-2 text-sm text-tg-hint italic">{settlement.comment}</div>
        )}
      </div>
    );
  }

  function renderExpenseCard(exp: Expense) {
    // A3: Expense amount color — green if I paid, red if I'm a participant who didn't pay
    const isPayer = currentUserId === exp.paidBy;
    const isParticipant = exp.participants.some((p) => p.userId === currentUserId);
    const amountColor = isPayer ? 'text-app-positive' : isParticipant ? 'text-app-negative' : '';

    return (
      <div key={`e-${exp.id}`} className="bg-tg-section p-4 rounded-xl border border-tg-separator">
        <div className="flex justify-between items-start">
          <div>
            <div className="font-medium">{exp.description}</div>
            <div className="text-sm text-tg-hint">
              {t('group.paidBy', { name: exp.payerName })} &middot; {timeAgo(exp.createdAt)}
            </div>
          </div>
          <div className={`font-medium ${amountColor}`}>
            {formatAmount(exp.amount, group?.currency)}
          </div>
        </div>
        <div className="mt-2 flex justify-between items-center">
          <div className="text-xs text-tg-hint">
            {t('group.splitAmong', { count: exp.participants.length })}:{' '}
            {exp.participants.map((p) => p.displayName).join(', ')}
          </div>
          {canModifyExpense(exp) && (
            <div className="flex gap-2 ml-2 shrink-0">
              <button
                onClick={() => navigate(`/groups/${groupId}/edit-expense/${exp.id}`)}
                className="text-xs text-tg-link"
              >
                {t('group.edit')}
              </button>
              <button
                onClick={() => handleDeleteExpense(exp.id)}
                className="text-xs text-tg-destructive"
              >
                {t('group.delete')}
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
            <div className="text-sm text-tg-hint">
              {t('group.member', { count: group.members.length })}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => shareInviteLink(group.inviteCode, group.name)}
              className="text-tg-link text-sm font-medium px-3 py-1 border border-tg-link rounded-lg"
            >
              {t('group.invite')}
            </button>
            {/* A6: Show "Info" for non-admin */}
            <button
              onClick={() => navigate(`/groups/${groupId}/settings`)}
              className="text-tg-hint text-sm font-medium px-3 py-1 border border-tg-separator rounded-lg"
            >
              {currentUserRole === 'admin' ? t('group.settings') : t('group.info')}
            </button>
          </div>
        </div>

        {/* Member list */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {group.members.map((m) => (
            <div
              key={m.userId}
              className="bg-tg-secondary-bg px-3 py-1 rounded-full text-sm flex items-center gap-1"
            >
              {m.role === 'admin' && <span title="Admin">&#9812;</span>}
              {m.displayName}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-tg-separator mb-4">
        <button
          onClick={() => setTab('transactions')}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 ${
            tab === 'transactions'
              ? 'border-tg-link text-tg-link'
              : 'border-transparent text-tg-hint'
          }`}
        >
          {t('group.transactions')}
        </button>
        <button
          onClick={() => setTab('balances')}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 ${
            tab === 'balances' ? 'border-tg-link text-tg-link' : 'border-transparent text-tg-hint'
          }`}
        >
          {t('group.balances')}
        </button>
      </div>

      {/* Content */}
      {tab === 'transactions' ? (
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <p className="text-center text-tg-hint py-8">{t('group.noTransactions')}</p>
          ) : (
            transactions.map((tx) =>
              tx.type === 'expense' ? renderExpenseCard(tx.data) : renderSettlementCard(tx.data),
            )
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {debts.length === 0 ? (
            <p className="text-center text-tg-hint py-8">{t('group.allSettled')}</p>
          ) : (
            debts.map((debt, i) => {
              // A1: Balance color based on perspective
              const isUserFrom = currentUserId === debt.from.userId;
              const isUserTo = currentUserId === debt.to.userId;
              const amountColor = isUserFrom
                ? 'text-app-negative'
                : isUserTo
                  ? 'text-app-positive'
                  : 'text-tg-text';

              return (
                <div key={i} className="bg-tg-section p-4 rounded-xl border border-tg-separator">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">
                        {isUserFrom ? 'You' : debt.from.displayName}
                      </span>
                      <span className="text-tg-hint">
                        {isUserFrom ? ` ${t('group.youOwe')} ` : ` ${t('group.owes')} `}
                      </span>
                      <span className="font-medium">{isUserTo ? 'you' : debt.to.displayName}</span>
                    </div>
                    <div className={`font-medium ${amountColor}`}>
                      {formatAmount(debt.amount, group?.currency)}
                    </div>
                  </div>
                  {isUserFrom && (
                    <button
                      onClick={() => handleSettleUp(debt)}
                      className="mt-3 w-full bg-tg-button text-tg-button-text py-2 rounded-lg text-sm font-medium"
                    >
                      {t('group.settleUp')}
                    </button>
                  )}
                  {isUserTo && (
                    <button
                      onClick={() => handleSettleUp(debt)}
                      className="mt-3 w-full text-tg-hint py-2 rounded-lg text-sm border border-tg-separator"
                    >
                      {t('group.markAsSettled')}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Add Expense FAB */}
      <button
        onClick={() => navigate(`/groups/${groupId}/add-expense`)}
        className="fixed bottom-20 right-6 bg-tg-button text-tg-button-text px-6 py-3 rounded-full shadow-lg font-medium"
      >
        {t('group.addExpense')}
      </button>
    </PageLayout>
  );
}
