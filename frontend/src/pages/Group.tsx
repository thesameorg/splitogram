import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type GroupDetail,
  type Expense,
  type DebtEntry,
  type BalanceMember,
  type SettlementListItem,
  type ActivityItem,
  type GroupStats,
} from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { resolveCurrentUser } from '../hooks/useCurrentUser';
import { formatAmount } from '../utils/format';
import { getCurrency } from '../utils/currencies';
import { timeAgo } from '../utils/time';
import { shareInviteLink } from '../utils/share';
import { mergeTransactions, type TransactionItem } from '../utils/transactions';
import { imageUrl } from '../utils/image';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { SuccessBanner } from '../components/SuccessBanner';
import { ReportImage } from '../components/ReportImage';
import { DonutChart } from '../components/DonutChart';
import { MonthSelector } from '../components/MonthSelector';
import { ErrorBanner } from '../components/ErrorBanner';
import { IconCheck, IconTon } from '../icons';
import { getActivityText } from './Activity';

export function Group() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const groupId = parseInt(id ?? '', 10);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [balanceMembers, setBalanceMembers] = useState<BalanceMember[]>([]);
  const [tab, setTab] = useState<'transactions' | 'balances' | 'feed' | 'stats'>('transactions');
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [receiptViewKey, setReceiptViewKey] = useState<string | null>(null);
  const [reminderSuccess, setReminderSuccess] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedSettlement, setSelectedSettlement] = useState<SettlementListItem | null>(null);
  const [reportImageKey, setReportImageKey] = useState<string | null>(null);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<string>('all');
  const [statsLoading, setStatsLoading] = useState(false);
  const [showClaimPrompt, setShowClaimPrompt] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [showGroupAvatar, setShowGroupAvatar] = useState(false);

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

  // Load activity when feed tab is selected
  useEffect(() => {
    if (tab !== 'feed' || activityItems.length > 0 || activityLoading || isNaN(groupId)) return;
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

  // Load stats when stats tab is selected or period changes
  useEffect(() => {
    if (tab !== 'stats' || isNaN(groupId)) return;
    setStatsLoading(true);
    api
      .getGroupStats(groupId, statsPeriod)
      .then((data) => setStats(data))
      .catch((err) => console.error('Failed to load stats:', err))
      .finally(() => setStatsLoading(false));
  }, [tab, groupId, statsPeriod]);

  // Show claim prompt only when user just joined the group (via ?joined=1 param)
  useEffect(() => {
    if (!group || !currentUserId || searchParams.get('joined') !== '1') return;
    const hasDummies = group.members.some((m) => m.isDummy);
    const iAmDummy = group.members.find((m) => m.userId === currentUserId)?.isDummy;
    if (hasDummies && !iAmDummy) {
      setShowClaimPrompt(true);
    }
    // Clear the param so it doesn't re-trigger
    setSearchParams({}, { replace: true });
  }, [group, currentUserId, searchParams, setSearchParams]);

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

  async function handleClaimPlaceholder(dummyUserId: number, dummyName: string) {
    const dummyBalance = balanceMembers.find((m) => m.userId === dummyUserId);
    const balanceStr = dummyBalance
      ? formatAmount(dummyBalance.netBalance, group?.currency)
      : formatAmount(0, group?.currency);

    const msg = `${t('placeholder.claimConfirmTitle', { name: dummyName })}\n\n${t('placeholder.claimConfirmBalance', { balance: balanceStr })}\n\n${t('placeholder.claimConfirmBody')}`;
    if (!confirm(msg)) return;

    setClaimError(null);
    try {
      const result = await api.claimPlaceholder(groupId, dummyUserId);
      setShowClaimPrompt(false);
      loadData();
      alert(t('placeholder.claimed', { name: result.dummyName }));
    } catch (err: any) {
      setClaimError(err.message || 'Failed to claim placeholder');
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
      <button
        key={`s-${settlement.id}`}
        onClick={() => setSelectedSettlement(settlement)}
        className="w-full text-left bg-app-positive-bg p-4 rounded-xl border border-app-positive/20"
      >
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            {settlement.status === 'settled_onchain' ? (
              <IconTon size={18} className="text-app-positive" />
            ) : (
              <IconCheck size={18} className="text-app-positive" />
            )}
            <div>
              <div className="font-medium text-app-positive">{label}</div>
              <div className="text-sm text-tg-hint">{timeAgo(settlement.createdAt)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {settlement.receiptThumbKey && (
              <img
                src={imageUrl(settlement.receiptThumbKey)}
                alt=""
                className="w-10 h-10 rounded-lg object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className={`font-medium ${amountColor}`}>
              {formatAmount(settlement.amount, group?.currency)}
            </div>
          </div>
        </div>
        {settlement.status === 'settled_onchain' && settlement.explorerUrl && (
          <div className="mt-2 text-xs">
            <a
              href={settlement.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-tg-link underline"
              onClick={(e) => e.stopPropagation()}
            >
              <IconTon size={12} />
              {t('settlement.viewTransaction')}
            </a>
          </div>
        )}
        {settlement.comment && (
          <div className="mt-2 text-sm text-tg-hint italic">{settlement.comment}</div>
        )}
      </button>
    );
  }

  function renderExpenseCard(exp: Expense) {
    const isPayer = currentUserId === exp.paidBy;
    const isParticipant = exp.participants.some((p) => p.userId === currentUserId);
    const amountColor = isPayer ? 'text-app-positive' : isParticipant ? 'text-app-negative' : '';

    return (
      <button
        key={`e-${exp.id}`}
        onClick={() => setSelectedExpense(exp)}
        className="w-full text-left bg-tg-section p-4 rounded-xl border border-tg-separator"
      >
        <div className="flex justify-between items-start">
          <div>
            <div className="font-medium">{exp.description}</div>
            <div className="text-sm text-tg-hint">
              {t('group.paidBy', { name: exp.payerName })} &middot; {timeAgo(exp.createdAt)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {exp.receiptThumbKey && (
              <img
                src={imageUrl(exp.receiptThumbKey)}
                alt=""
                className="w-10 h-10 rounded-lg object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className={`font-medium ${amountColor}`}>
              {formatAmount(exp.amount, group?.currency)}
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-tg-hint">
          {exp.participants.length > 3
            ? t('group.splitAmong', { count: exp.participants.length })
            : `${t('group.splitAmong', { count: exp.participants.length })}: ${exp.participants.map((p) => p.displayName).join(', ')}`}
        </div>
      </button>
    );
  }

  if (loading || !group) return <LoadingScreen />;

  return (
    <PageLayout>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            {group.avatarKey ? (
              <button onClick={() => setShowGroupAvatar(true)}>
                <Avatar
                  avatarKey={group.avatarKey}
                  emoji={group.avatarEmoji}
                  displayName={group.name}
                  size="lg"
                />
              </button>
            ) : (
              <Avatar
                avatarKey={group.avatarKey}
                emoji={group.avatarEmoji}
                displayName={group.name}
                size="lg"
              />
            )}
            <div>
              <h1 className="text-xl font-bold">{group.name}</h1>
              <div className="text-sm text-tg-hint">
                {t('group.member', { count: group.members.length })} &middot;{' '}
                {getCurrency(group.currency).symbol}
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

      {claimError && <ErrorBanner message={claimError} onDismiss={() => setClaimError(null)} />}

      {/* Tabs */}
      <div className="flex border-b border-tg-separator mb-4">
        {(['transactions', 'balances', 'feed', 'stats'] as const).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`flex-1 pb-2 text-sm font-medium border-b-2 ${
              tab === tabKey ? 'border-tg-link text-tg-link' : 'border-transparent text-tg-hint'
            }`}
          >
            {t(`group.${tabKey}`)}
          </button>
        ))}
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

      {tab === 'feed' && (
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
                    <div
                      className={`text-sm ${item.type === 'expense_deleted' ? 'text-tg-hint line-through' : ''}`}
                    >
                      {getActivityText(item, t, currentUserId, group?.currency)}
                    </div>
                    <span className="text-xs text-tg-hint">{timeAgo(item.createdAt)}</span>
                  </div>
                  {item.type === 'settlement_completed' && (item.metadata as any)?.explorerUrl && (
                    <a
                      href={(item.metadata as any).explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-xs text-tg-link shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconTon size={12} />
                      TX
                    </a>
                  )}
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
                  <span className="flex-1 font-medium">
                    {group.members.find((gm) => gm.userId === m.userId)?.isDummy
                      ? `\uD83D\uDC64 ${m.displayName}`
                      : m.displayName}
                    {group.members.find((gm) => gm.userId === m.userId)?.muted && (
                      <span className="ml-1 text-tg-hint" title="Muted">
                        {'\uD83D\uDD07'}
                      </span>
                    )}
                  </span>
                  <span className={`text-sm font-medium ${balanceColor}`}>
                    {m.netBalance === 0
                      ? t('group.settledUp')
                      : formatAmount(m.netBalance, group?.currency)}
                  </span>
                  {group.members.find((gm) => gm.userId === m.userId)?.isDummy && (
                    <button
                      onClick={() => handleClaimPlaceholder(m.userId, m.displayName)}
                      className="text-xs text-tg-link font-medium ml-1 shrink-0"
                    >
                      {t('placeholder.claimButton')}
                    </button>
                  )}
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
                        {group.members.find((m) => m.userId === debt.from.userId)?.isDummy ? (
                          <button
                            onClick={() => shareInviteLink(group.inviteCode, group.name)}
                            className="flex-1 text-tg-link py-2 rounded-lg text-sm border border-tg-link"
                          >
                            {t('group.invite')}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSendReminder(debt)}
                            className="flex-1 text-tg-link py-2 rounded-lg text-sm border border-tg-link"
                          >
                            {t('group.sendReminder')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-4">
          {statsLoading ? (
            <p className="text-center text-tg-hint py-8">{t('loading')}</p>
          ) : !stats ? null : (
            <>
              {/* Donut chart */}
              <DonutChart
                segments={stats.memberShares.map((m) => ({
                  label: m.displayName,
                  value: m.share,
                  isCurrentUser: m.userId === currentUserId,
                }))}
                total={stats.totalSpent}
                currency={group?.currency ?? 'USD'}
              />

              {/* Key metrics */}
              <div className="bg-tg-section rounded-xl border border-tg-separator p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-tg-hint text-sm">{t('group.statsTotalSpent')}</span>
                  <span className="font-bold text-lg">
                    {formatAmount(stats.totalSpent, group?.currency)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-tg-hint text-sm">{t('group.statsYourShare')}</div>
                    {stats.totalSpent > 0 && (
                      <div className="text-xs text-tg-hint">
                        {t('group.statsSharePercent', {
                          percent: Math.round((stats.yourShare / stats.totalSpent) * 100),
                        })}
                      </div>
                    )}
                  </div>
                  <span className="font-bold text-lg">
                    {formatAmount(stats.yourShare, group?.currency)}
                  </span>
                </div>
              </div>

              {/* Additional stats */}
              <div>
                <div className="text-xs font-medium text-tg-hint uppercase tracking-wide mb-2">
                  {t('group.statsAdditional')}
                </div>
                <div className="bg-tg-section rounded-xl border border-tg-separator divide-y divide-tg-separator">
                  <div className="flex justify-between items-center p-4">
                    <span className="text-sm">{t('group.statsPaidFor')}</span>
                    <span className="text-sm font-medium">
                      {formatAmount(stats.totalPaidFor, group?.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4">
                    <span className="text-sm">{t('group.statsPaymentsMade')}</span>
                    <span className="text-sm font-medium">
                      {formatAmount(stats.paymentsMade, group?.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4">
                    <span className="text-sm">{t('group.statsPaymentsReceived')}</span>
                    <span className="text-sm font-medium">
                      {formatAmount(stats.paymentsReceived, group?.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4">
                    <span className="text-sm">{t('group.statsBalanceChange')}</span>
                    <span
                      className={`text-sm font-medium ${
                        stats.balanceChange > 0
                          ? 'text-app-positive'
                          : stats.balanceChange < 0
                            ? 'text-app-negative'
                            : ''
                      }`}
                    >
                      {formatAmount(stats.balanceChange, group?.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Month selector */}
              <MonthSelector
                availableMonths={stats.availableMonths}
                selected={statsPeriod}
                onChange={setStatsPeriod}
              />
            </>
          )}
        </div>
      )}

      {/* Add Expense FAB */}
      {tab === 'transactions' && (
        <button
          onClick={() => navigate(`/groups/${groupId}/add-expense`)}
          className="fixed bottom-20 right-6 bg-tg-button text-tg-button-text px-6 py-3 rounded-full shadow-lg font-medium"
        >
          {t('group.addExpense')}
        </button>
      )}

      {/* Expense detail */}
      <BottomSheet
        open={!!selectedExpense}
        onClose={() => setSelectedExpense(null)}
        title={selectedExpense?.description ?? ''}
      >
        {selectedExpense && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-3xl font-bold">
                {formatAmount(selectedExpense.amount, group?.currency)}
              </div>
              <div className="text-sm text-tg-hint mt-1">
                {t('group.paidBy', { name: selectedExpense.payerName })}
              </div>
              {selectedExpense.splitMode && selectedExpense.splitMode !== 'equal' && (
                <div className="text-xs text-tg-hint mt-1">
                  {t(
                    `addExpense.split${selectedExpense.splitMode.charAt(0).toUpperCase() + selectedExpense.splitMode.slice(1)}`,
                  )}
                </div>
              )}
            </div>

            {/* Per-person breakdown */}
            <div>
              <div className="text-xs font-medium text-tg-hint uppercase tracking-wide mb-2">
                {t('group.splitAmong', { count: selectedExpense.participants.length })}
              </div>
              <div className="space-y-1">
                {selectedExpense.participants.map((p) => (
                  <div
                    key={p.userId}
                    className="flex justify-between items-center py-1.5 px-2 rounded-lg"
                  >
                    <span className="text-sm">{p.displayName}</span>
                    <span className="text-sm font-medium">
                      {formatAmount(p.shareAmount, group?.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Comment */}
            {selectedExpense.comment && (
              <div className="text-sm text-tg-text bg-tg-section rounded-xl px-3 py-2">
                {selectedExpense.comment}
              </div>
            )}

            {/* Receipt */}
            {selectedExpense.receiptThumbKey && (
              <button
                onClick={() => {
                  setReceiptViewKey(selectedExpense.receiptKey);
                  setSelectedExpense(null);
                }}
              >
                <img
                  src={imageUrl(selectedExpense.receiptThumbKey)}
                  alt="Receipt"
                  className="w-20 h-20 rounded-xl object-cover border border-tg-separator"
                />
              </button>
            )}

            {/* Date */}
            <div className="text-xs text-tg-hint text-center">
              {timeAgo(selectedExpense.createdAt)}
            </div>

            {/* Actions */}
            {(canEditExpense(selectedExpense) || canDeleteExpense(selectedExpense)) && (
              <div className="flex gap-3 pt-2">
                {canEditExpense(selectedExpense) && (
                  <button
                    onClick={() => {
                      const eid = selectedExpense.id;
                      setSelectedExpense(null);
                      navigate(`/groups/${groupId}/edit-expense/${eid}`);
                    }}
                    className="flex-1 py-2 rounded-xl text-sm font-medium text-tg-link border border-tg-link"
                  >
                    {t('group.edit')}
                  </button>
                )}
                {canDeleteExpense(selectedExpense) && (
                  <button
                    onClick={() => {
                      const eid = selectedExpense.id;
                      setSelectedExpense(null);
                      handleDeleteExpense(eid);
                    }}
                    className="flex-1 py-2 rounded-xl text-sm font-medium text-tg-destructive border border-tg-destructive"
                  >
                    {t('group.delete')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Settlement detail */}
      <BottomSheet
        open={!!selectedSettlement}
        onClose={() => setSelectedSettlement(null)}
        title={t('settleUp.title')}
      >
        {selectedSettlement && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-3xl font-bold">
                {formatAmount(selectedSettlement.amount, group?.currency)}
              </div>
              <div className="text-sm text-tg-hint mt-1">
                {selectedSettlement.fromUserName} &rarr; {selectedSettlement.toUserName}
              </div>
            </div>

            {selectedSettlement.status === 'settled_onchain' && selectedSettlement.explorerUrl && (
              <div className="text-center">
                <a
                  href={selectedSettlement.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-tg-link underline"
                >
                  <IconTon size={14} />
                  {t('settlement.viewTransaction')}
                </a>
              </div>
            )}

            {selectedSettlement.comment && (
              <div className="text-sm text-tg-hint italic text-center">
                {selectedSettlement.comment}
              </div>
            )}

            {selectedSettlement.receiptThumbKey && (
              <button
                onClick={() => {
                  setReceiptViewKey(selectedSettlement.receiptKey);
                  setSelectedSettlement(null);
                }}
                className="mx-auto block"
              >
                <img
                  src={imageUrl(selectedSettlement.receiptThumbKey)}
                  alt="Receipt"
                  className="w-20 h-20 rounded-xl object-cover border border-tg-separator"
                />
              </button>
            )}

            <div className="text-xs text-tg-hint text-center">
              {timeAgo(selectedSettlement.createdAt)}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Receipt viewer */}
      <BottomSheet open={!!receiptViewKey} onClose={() => setReceiptViewKey(null)} title="">
        {receiptViewKey && (
          <div>
            <img
              src={imageUrl(receiptViewKey)}
              alt="Receipt"
              className="w-full rounded-xl"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <button
              onClick={() => {
                setReportImageKey(receiptViewKey);
                setReceiptViewKey(null);
              }}
              className="mt-3 text-xs text-tg-hint"
            >
              ⚠️ {t('report.button')}
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Report image */}
      <ReportImage
        imageKey={reportImageKey}
        open={!!reportImageKey}
        onClose={() => setReportImageKey(null)}
      />

      {/* Group avatar viewer */}
      <BottomSheet open={showGroupAvatar} onClose={() => setShowGroupAvatar(false)} title="">
        {group.avatarKey && (
          <div>
            <img
              src={imageUrl(group.avatarKey)}
              alt={group.name}
              className="w-full rounded-xl"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <button
              onClick={() => {
                setReportImageKey(group.avatarKey);
                setShowGroupAvatar(false);
              }}
              className="mt-3 text-xs text-tg-hint"
            >
              ⚠️ {t('report.button')}
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Claim placeholder prompt */}
      <BottomSheet
        open={showClaimPrompt}
        onClose={() => setShowClaimPrompt(false)}
        title={t('placeholder.claimBanner')}
      >
        <div className="space-y-3">
          {group.members
            .filter((m) => m.isDummy)
            .map((m) => {
              const bal = balanceMembers.find((bm) => bm.userId === m.userId);
              const balStr = bal
                ? formatAmount(bal.netBalance, group?.currency)
                : formatAmount(0, group?.currency);
              return (
                <button
                  key={m.userId}
                  onClick={() => {
                    setShowClaimPrompt(false);
                    handleClaimPlaceholder(m.userId, m.displayName);
                  }}
                  className="w-full flex items-center justify-between p-3 bg-tg-section rounded-xl border border-tg-separator"
                >
                  <div className="flex items-center gap-2">
                    <span>{'\uD83D\uDC64'}</span>
                    <span className="font-medium">{m.displayName}</span>
                  </div>
                  <span className="text-sm text-tg-hint">{balStr}</span>
                </button>
              );
            })}
          <button
            onClick={() => setShowClaimPrompt(false)}
            className="w-full py-3 text-sm text-tg-hint font-medium"
          >
            {t('placeholder.claimCancel')}
          </button>
        </div>
      </BottomSheet>
    </PageLayout>
  );
}
