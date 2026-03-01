import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type GroupDetail,
  type Expense,
  type DebtEntry,
  type BalanceMember,
  type SettlementListItem,
  type ActivityItem,
} from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { resolveCurrentUser } from '../hooks/useCurrentUser';
import { formatAmount } from '../utils/format';
import { timeAgo } from '../utils/time';
import { shareInviteLink } from '../utils/share';
import { mergeTransactions, type TransactionItem } from '../utils/transactions';
import { imageUrl } from '../utils/image';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { SuccessBanner } from '../components/SuccessBanner';
import { IconCheck } from '../icons';
import { getActivityText } from './Activity';

export function Group() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const groupId = parseInt(id ?? '', 10);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [balanceMembers, setBalanceMembers] = useState<BalanceMember[]>([]);
  const [tab, setTab] = useState<'transactions' | 'balances' | 'activity'>('transactions');
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [receiptViewKey, setReceiptViewKey] = useState<string | null>(null);
  const [reminderSuccess, setReminderSuccess] = useState(false);

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
      setBalanceMembers(balancesData.members ?? []);

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

  // Load activity when tab is selected
  useEffect(() => {
    if (tab !== 'activity' || activityItems.length > 0 || activityLoading || isNaN(groupId)) return;
    setActivityLoading(true);
    api
      .getGroupActivity(groupId)
      .then((data) => {
        setActivityItems(data.items);
        setActivityCursor(data.nextCursor);
      })
      .catch((err) => console.error('Failed to load activity:', err))
      .finally(() => setActivityLoading(false));
  }, [tab, groupId, activityItems.length, activityLoading]);

  function canEditExpense(exp: Expense): boolean {
    return currentUserId === exp.paidBy;
  }

  function canDeleteExpense(exp: Expense): boolean {
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

  async function handleSendReminder(debt: DebtEntry) {
    try {
      await api.sendReminder(groupId, debt.from.userId);
      setReminderSuccess(true);
      setTimeout(() => setReminderSuccess(false), 2000);
    } catch (err: any) {
      if (err?.errorCode === 'cooldown') {
        alert(t('group.reminderCooldown'));
      } else {
        console.error('Failed to send reminder:', err);
      }
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
            <IconCheck size={18} className="text-app-positive" />
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
        {exp.receiptThumbKey && (
          <button onClick={() => setReceiptViewKey(exp.receiptKey)} className="mt-2">
            <img
              src={imageUrl(exp.receiptThumbKey)}
              alt="Receipt"
              className="w-16 h-16 rounded-lg object-cover border border-tg-separator"
            />
          </button>
        )}
        <div className="mt-2 flex justify-between items-center">
          <div className="text-xs text-tg-hint">
            {t('group.splitAmong', { count: exp.participants.length })}:{' '}
            {exp.participants.map((p) => p.displayName).join(', ')}
          </div>
          {(canEditExpense(exp) || canDeleteExpense(exp)) && (
            <div className="flex gap-2 ml-2 shrink-0">
              {canEditExpense(exp) && (
                <button
                  onClick={() => navigate(`/groups/${groupId}/edit-expense/${exp.id}`)}
                  className="text-xs text-tg-link"
                >
                  {t('group.edit')}
                </button>
              )}
              {canDeleteExpense(exp) && (
                <button
                  onClick={() => handleDeleteExpense(exp.id)}
                  className="text-xs text-tg-destructive"
                >
                  {t('group.delete')}
                </button>
              )}
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
          <div className="flex items-center gap-3">
            <Avatar
              avatarKey={group.avatarKey}
              emoji={group.avatarEmoji}
              displayName={group.name}
              size="lg"
            />
            <div>
              <h1 className="text-xl font-bold">{group.name}</h1>
              <div className="text-sm text-tg-hint">
                {t('group.member', { count: group.members.length })}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => shareInviteLink(group.inviteCode, group.name)}
              className="text-tg-link text-sm font-medium px-3 py-1 border border-tg-link rounded-lg"
            >
              {t('group.invite')}
            </button>
            <button
              onClick={() => navigate(`/groups/${groupId}/settings`)}
              className={`text-sm font-medium px-3 py-1 border rounded-lg ${
                currentUserRole === 'admin'
                  ? 'text-tg-link border-tg-link'
                  : 'text-tg-hint border-tg-separator'
              }`}
            >
              {currentUserRole === 'admin' ? t('group.settings') : t('group.info')}
            </button>
          </div>
        </div>
      </div>

      {reminderSuccess && (
        <SuccessBanner
          message={t('group.reminderSent')}
          onDismiss={() => setReminderSuccess(false)}
        />
      )}

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
        <button
          onClick={() => setTab('activity')}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 ${
            tab === 'activity' ? 'border-tg-link text-tg-link' : 'border-transparent text-tg-hint'
          }`}
        >
          {t('activity.title')}
        </button>
      </div>

      {/* Content */}
      {tab === 'transactions' && (
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <p className="text-center text-tg-hint py-8">{t('group.noTransactions')}</p>
          ) : (
            transactions.map((tx) =>
              tx.type === 'expense' ? renderExpenseCard(tx.data) : renderSettlementCard(tx.data),
            )
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-2">
          {activityLoading ? (
            <p className="text-center text-tg-hint py-8">{t('loading')}</p>
          ) : activityItems.length === 0 ? (
            <p className="text-center text-tg-hint py-8">{t('activity.empty')}</p>
          ) : (
            <>
              {activityItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-xl bg-tg-section border border-tg-separator"
                >
                  <Avatar avatarKey={item.actorAvatarKey} displayName={item.actorName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{getActivityText(item, t, currentUserId)}</div>
                    <span className="text-xs text-tg-hint">{timeAgo(item.createdAt)}</span>
                  </div>
                  {item.amount != null && item.amount > 0 && (
                    <span className="text-sm font-medium text-tg-text shrink-0">
                      {formatAmount(item.amount, group?.currency)}
                    </span>
                  )}
                </div>
              ))}
              {activityCursor && (
                <button
                  onClick={async () => {
                    const data = await api.getGroupActivity(groupId, activityCursor);
                    setActivityItems((prev) => [...prev, ...data.items]);
                    setActivityCursor(data.nextCursor);
                  }}
                  className="w-full py-3 text-sm text-tg-link font-medium"
                >
                  {t('activity.loadMore')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'balances' && (
        <div className="space-y-3">
          {/* All members with net balances */}
          <div className="text-xs font-medium text-tg-hint uppercase tracking-wide mb-2">
            {t('group.allMembers')}
          </div>
          {[...balanceMembers]
            .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance))
            .map((m) => {
              const balanceColor =
                m.netBalance > 0
                  ? 'text-app-positive'
                  : m.netBalance < 0
                    ? 'text-app-negative'
                    : 'text-tg-hint';
              return (
                <div
                  key={m.userId}
                  className="flex items-center gap-3 bg-tg-section p-3 rounded-xl border border-tg-separator"
                >
                  <Avatar avatarKey={m.avatarKey} displayName={m.displayName} size="sm" />
                  <span className="flex-1 font-medium">{m.displayName}</span>
                  <span className={`text-sm font-medium ${balanceColor}`}>
                    {m.netBalance === 0
                      ? t('group.settledUp')
                      : formatAmount(m.netBalance, group?.currency)}
                  </span>
                </div>
              );
            })}

          {/* Actionable debt cards */}
          {debts.length > 0 && (
            <>
              <div className="text-xs font-medium text-tg-hint uppercase tracking-wide mt-4 mb-2">
                {t('group.balances')}
              </div>
              {debts.map((debt, i) => {
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
                        <span className="font-medium">
                          {isUserTo ? 'you' : debt.to.displayName}
                        </span>
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
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => handleSettleUp(debt)}
                          className="flex-1 text-tg-hint py-2 rounded-lg text-sm border border-tg-separator"
                        >
                          {t('group.markAsSettled')}
                        </button>
                        <button
                          onClick={() => handleSendReminder(debt)}
                          className="flex-1 text-tg-link py-2 rounded-lg text-sm border border-tg-link"
                        >
                          {t('group.sendReminder')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
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

      {/* Receipt viewer */}
      <BottomSheet open={!!receiptViewKey} onClose={() => setReceiptViewKey(null)} title="">
        {receiptViewKey && (
          <img src={imageUrl(receiptViewKey)} alt="Receipt" className="w-full rounded-xl" />
        )}
      </BottomSheet>
    </PageLayout>
  );
}
