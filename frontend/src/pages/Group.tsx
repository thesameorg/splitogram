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
import { shareInviteLink, sharePersonalizedInviteLink } from '../utils/share';
import { mergeTransactions, type TransactionItem } from '../utils/transactions';
import { imageUrl } from '../utils/image';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { SuccessBanner } from '../components/SuccessBanner';
import { ImageViewer } from '../components/ImageViewer';
import { DonutChart } from '../components/DonutChart';
import { MonthSelector } from '../components/MonthSelector';
import { ErrorBanner } from '../components/ErrorBanner';
import { IconCheck, IconTon, IconUserPlus, IconSettings, IconInfo } from '../icons';
import { openExternalLink } from '../utils/links';
import { getActivityText } from '../utils/activity';

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
  const initialTab = (() => {
    const t = searchParams.get('tab');
    if (t === 'balances' || t === 'feed' || t === 'stats') return t;
    return 'transactions' as const;
  })();
  const [tab, setTab] = useState<'transactions' | 'balances' | 'feed' | 'stats'>(initialTab);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [currentUserJoinedAt, setCurrentUserJoinedAt] = useState<string | null>(null);
  const [reminderSuccess, setReminderSuccess] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedSettlement, setSelectedSettlement] = useState<SettlementListItem | null>(null);
  const [viewImageKey, setViewImageKey] = useState<string | null>(null);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<string>('all');
  const [statsLoading, setStatsLoading] = useState(false);
  const [showClaimPrompt, setShowClaimPrompt] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [userHasClaimed, setUserHasClaimed] = useState(() => {
    try {
      return localStorage.getItem(`claimed_placeholder_${groupId}`) === '1';
    } catch {
      return false;
    }
  });
  const [showInviteNudge, setShowInviteNudge] = useState(false);
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);

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
        setCurrentUserJoinedAt(user.joinedAt);
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

  // Auto-check pending settlements (trigger confirmation check in background)
  useEffect(() => {
    if (loading || transactions.length === 0) return;
    const pendingSettlements = transactions.filter(
      (tx): tx is TransactionItem & { type: 'settlement' } =>
        tx.type === 'settlement' && tx.data.status === 'payment_pending',
    );
    if (pendingSettlements.length === 0) return;

    // Fire-and-forget confirm calls — if any resolves, reload data
    Promise.all(
      pendingSettlements.map((tx) => api.confirmSettlement(tx.data.id).catch(() => null)),
    ).then((results) => {
      const changed = results.some(
        (r) => r && (r.status === 'settled_onchain' || r.status === 'open'),
      );
      if (changed) loadData();
    });
  }, [loading, transactions, loadData]);

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

  // Auto-claim from personalized invite link (?claim={placeholderId})
  useEffect(() => {
    if (!group || !currentUserId) return;
    const claimParam = searchParams.get('claim');
    if (!claimParam) return;
    const claimId = parseInt(claimParam, 10);
    if (isNaN(claimId)) return;

    const iAmDummy = group.members.find((m) => m.userId === currentUserId)?.isDummy;
    if (iAmDummy || currentUserRole === 'admin' || userHasClaimed) {
      // Can't claim — clear param and show welcome
      setShowWelcomeBanner(true);
      setSearchParams({}, { replace: true });
      return;
    }

    const placeholder = group.members.find((m) => m.userId === claimId && m.isDummy);
    if (!placeholder) {
      // Placeholder already claimed or doesn't exist — show generic claim prompt
      setShowWelcomeBanner(true);
      setSearchParams({}, { replace: true });
      return;
    }

    // Auto-claim: show confirmation dialog
    setSearchParams({}, { replace: true });
    handleClaimPlaceholder(placeholder.userId, placeholder.displayName);
  }, [group, currentUserId, searchParams]);

  // Show claim prompt only when user just joined the group (via ?joined=1 param, no ?claim)
  useEffect(() => {
    if (!group || !currentUserId || !currentUserJoinedAt || searchParams.get('joined') !== '1')
      return;
    if (searchParams.get('claim')) return; // handled by auto-claim effect above
    const iAmDummy = group.members.find((m) => m.userId === currentUserId)?.isDummy;
    // Only show placeholders that existed before the user joined
    const claimableDummies = group.members.some(
      (m) => m.isDummy && m.joinedAt <= currentUserJoinedAt,
    );
    if (claimableDummies && !iAmDummy && currentUserRole !== 'admin' && !userHasClaimed) {
      setShowClaimPrompt(true);
    }
    setShowWelcomeBanner(true);
    // Clear the param so it doesn't re-trigger
    setSearchParams({}, { replace: true });
  }, [group, currentUserId, searchParams, setSearchParams]);

  // Auto-open share dialog when group was just created (via ?created=1 param)
  useEffect(() => {
    if (!group || searchParams.get('created') !== '1') return;
    setShowInviteNudge(true);
    setSearchParams({}, { replace: true });
    // Auto-open Telegram share dialog — zero taps to invite
    shareInviteLink(group.inviteCode, group.name, group.members.length);
  }, [group, searchParams, setSearchParams]);

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

  async function handleExportCsv() {
    try {
      const blob = await api.exportGroupCsv(groupId);
      const filename = `${group?.name || 'transactions'}.csv`;
      const file = new File([blob], filename, { type: 'text/csv' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        // Fallback: download directly
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      // User cancelled share — not an error
      if (err?.name === 'AbortError') return;
      console.error('Export failed:', err);
    }
  }

  async function handleSettleUp(debt: DebtEntry, mode: 'manual' | 'ton') {
    try {
      const result = await api.createSettlement(groupId, debt.from.userId, debt.to.userId);
      navigate(`/settle/${result.settlement.id}/${mode}`);
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
      setUserHasClaimed(true);
      try {
        localStorage.setItem(`claimed_placeholder_${groupId}`, '1');
      } catch {}
      setShowClaimPrompt(false);
      loadData();
      alert(t('placeholder.claimed', { name: result.dummyName }));
    } catch (err: any) {
      if (err?.errorCode === 'already_claimed') {
        setUserHasClaimed(true);
        try {
          localStorage.setItem(`claimed_placeholder_${groupId}`, '1');
        } catch {}
      }
      setClaimError(err.message || 'Failed to claim placeholder');
    }
  }

  function renderSettlementCard(settlement: SettlementListItem) {
    const isFromMe = currentUserId === settlement.fromUser;
    const isToMe = currentUserId === settlement.toUser;
    const isPending = settlement.status === 'payment_pending';

    let label: string;
    if (isPending) {
      if (isFromMe) {
        label = t('settlement.pendingYouPay', { name: settlement.toUserName });
      } else if (isToMe) {
        label = t('settlement.pendingPayYou', { name: settlement.fromUserName });
      } else {
        label = t('settlement.pendingPay', {
          from: settlement.fromUserName,
          to: settlement.toUserName,
        });
      }
    } else if (isFromMe) {
      label = t('group.youPaid', { name: settlement.toUserName });
    } else if (isToMe) {
      label = t('group.paidYou', { name: settlement.fromUserName });
    } else {
      label = t('group.paid', { from: settlement.fromUserName, to: settlement.toUserName });
    }

    const amountColor = isPending
      ? 'text-app-warning'
      : isFromMe
        ? 'text-app-negative'
        : 'text-app-positive';
    const bgColor = isPending ? 'bg-app-warning-bg' : 'bg-app-positive-bg';
    const borderColor = isPending ? 'border-app-warning/20' : 'border-app-positive/20';
    const textColor = isPending ? 'text-app-warning' : 'text-app-positive';

    return (
      <button
        key={`s-${settlement.id}`}
        onClick={() =>
          isPending ? navigate(`/settle/${settlement.id}/ton`) : setSelectedSettlement(settlement)
        }
        className={`w-full text-left ${bgColor} p-4 rounded-xl border ${borderColor}`}
      >
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="shrink-0">
              {isPending ? (
                <div className="w-[18px] h-[18px] border-2 border-app-warning border-t-transparent rounded-full animate-spin" />
              ) : settlement.status === 'settled_onchain' ? (
                <IconTon size={18} className="text-app-positive" />
              ) : (
                <IconCheck size={18} className="text-app-positive" />
              )}
            </div>
            <div className="min-w-0">
              <div className={`font-medium ${textColor} truncate`}>{label}</div>
              <div className="text-sm text-tg-hint">{timeAgo(settlement.createdAt)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
        {isPending && (
          <div className="mt-2 text-xs text-app-warning">{t('settlement.tapToCheck')}</div>
        )}
        {settlement.status === 'settled_onchain' && settlement.explorerUrl && (
          <div className="mt-2 text-xs">
            <button
              onClick={(e) => openExternalLink(settlement.explorerUrl!, e)}
              className="inline-flex items-center gap-1 text-tg-link underline"
            >
              <IconTon size={12} />
              {t('settlement.viewTransaction')}
            </button>
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
        className="w-full text-left card p-4 rounded-2xl"
      >
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{exp.description}</div>
            <div className="text-sm text-tg-hint truncate">
              {t('group.paidBy', { name: exp.payerName })} &middot; {timeAgo(exp.createdAt)}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
        <div className="mt-2 text-xs text-tg-hint truncate">
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
      <div className="mb-8 card p-4 rounded-2xl header-glow">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            {group.avatarKey ? (
              <button onClick={() => group.avatarKey && setViewImageKey(group.avatarKey)}>
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
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold truncate">{group.name}</h1>
            <div className="text-sm text-tg-hint tracking-label">
              {t('group.member', { count: group.members.length })} &middot;{' '}
              {getCurrency(group.currency).symbol}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => shareInviteLink(group.inviteCode, group.name, group.members.length)}
              className="p-1.5 border border-ghost rounded-lg text-tg-link"
              aria-label={t('group.invite')}
            >
              <IconUserPlus size={20} />
            </button>
            <button
              onClick={() => navigate(`/groups/${groupId}/settings`)}
              className="p-1.5 border border-ghost rounded-lg text-tg-link"
              aria-label={currentUserRole === 'admin' ? t('group.settings') : t('group.info')}
            >
              {currentUserRole === 'admin' ? <IconSettings size={20} /> : <IconInfo size={20} />}
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

      {/* Invite nudge — shown right after group creation */}
      {showInviteNudge && (
        <div className="mb-4 card p-4 rounded-2xl">
          <p className="text-sm font-medium mb-3">{t('group.inviteNudge')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                shareInviteLink(group.inviteCode, group.name, group.members.length);
                setShowInviteNudge(false);
              }}
              className="flex-1 bg-tg-button text-tg-button-text py-2.5 rounded-xl text-sm font-medium"
            >
              {t('group.inviteNudgeButton')}
            </button>
            <button
              onClick={() => setShowInviteNudge(false)}
              className="px-4 py-2.5 rounded-xl text-sm text-tg-hint border border-ghost"
            >
              {t('group.inviteNudgeLater')}
            </button>
          </div>
        </div>
      )}

      {/* Welcome banner — shown when user just joined */}
      {showWelcomeBanner && !showInviteNudge && (
        <div className="mb-4 bg-app-positive-bg p-4 rounded-xl border border-app-positive/20">
          <p className="text-sm font-medium text-app-positive">{t('group.welcomeBanner')}</p>
          <button
            onClick={() => setShowWelcomeBanner(false)}
            className="mt-1 text-xs text-tg-hint"
            aria-label="Dismiss"
          >
            {t('group.inviteNudgeLater')}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-ghost mb-6">
        {(['transactions', 'balances', 'feed', 'stats'] as const).map((tabKey) => {
          const hasDebt =
            tabKey === 'balances' && debts.some((d) => d.from.userId === currentUserId);
          return (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`flex-1 pb-2 text-sm font-medium border-b-2 relative ${
                tab === tabKey ? 'border-tg-link text-tg-link' : 'border-transparent text-tg-hint'
              }`}
            >
              {t(`group.${tabKey}`)}
              {hasDebt && (
                <span className="absolute -top-0.5 ml-0.5 inline-flex bg-red-500 text-white text-[8px] font-bold w-3.5 h-3.5 rounded-full items-center justify-center leading-none">
                  !
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {tab === 'transactions' && (
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">📝</div>
              <p className="text-tg-hint mb-3">{t('group.noTransactions')}</p>
              {group.members.length <= 1 && (
                <button
                  onClick={() =>
                    shareInviteLink(group.inviteCode, group.name, group.members.length)
                  }
                  className="text-sm text-tg-link font-medium"
                >
                  {t('group.inviteNudgeButton')}
                </button>
              )}
            </div>
          ) : (
            <>
              {transactions.map((tx) =>
                tx.type === 'expense' ? renderExpenseCard(tx.data) : renderSettlementCard(tx.data),
              )}
            </>
          )}
        </div>
      )}

      {tab === 'feed' && (
        <div className="space-y-2">
          {activityLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-tg-hint/30 border-t-tg-hint rounded-full animate-spin" />
            </div>
          ) : activityItems.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">📰</div>
              <p className="text-tg-hint">{t('activity.empty')}</p>
            </div>
          ) : (
            <>
              {activityItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-2xl card"
                >
                  <Avatar avatarKey={item.actorAvatarKey} displayName={item.actorName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm line-clamp-2 ${item.type === 'expense_deleted' ? 'text-tg-hint line-through' : ''}`}
                    >
                      {getActivityText(item, t, currentUserId, group?.currency)}
                    </div>
                    <span className="text-xs text-tg-hint">{timeAgo(item.createdAt)}</span>
                  </div>
                  {item.type === 'settlement_completed' && (item.metadata as any)?.explorerUrl && (
                    <button
                      onClick={(e) => openExternalLink((item.metadata as any).explorerUrl, e)}
                      className="inline-flex items-center gap-0.5 text-xs text-tg-link shrink-0"
                    >
                      <IconTon size={12} />
                      TX
                    </button>
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
          {[...balanceMembers]
            .sort((a, b) => {
              const aIsMe = a.userId === currentUserId;
              const bIsMe = b.userId === currentUserId;
              if (aIsMe && !bIsMe) return -1;
              if (!aIsMe && bIsMe) return 1;

              const aIOwe = debts.some(
                (d) => d.from.userId === currentUserId && d.to.userId === a.userId,
              );
              const bIOwe = debts.some(
                (d) => d.from.userId === currentUserId && d.to.userId === b.userId,
              );
              const aOwesMe = debts.some(
                (d) => d.to.userId === currentUserId && d.from.userId === a.userId,
              );
              const bOwesMe = debts.some(
                (d) => d.to.userId === currentUserId && d.from.userId === b.userId,
              );

              const prio = (iOwe: boolean, owesMe: boolean, bal: number) => {
                if (iOwe) return 1;
                if (owesMe) return 2;
                if (bal !== 0) return 3;
                return 4;
              };

              const ap = prio(aIOwe, aOwesMe, a.netBalance);
              const bp = prio(bIOwe, bOwesMe, b.netBalance);
              if (ap !== bp) return ap - bp;
              return Math.abs(b.netBalance) - Math.abs(a.netBalance);
            })
            .map((m) => {
              const balanceColor =
                m.netBalance > 0
                  ? 'text-app-positive'
                  : m.netBalance < 0
                    ? 'text-app-negative'
                    : 'text-tg-hint';
              const member = group.members.find((gm) => gm.userId === m.userId);
              const debtIOwe = debts.find(
                (d) => d.from.userId === currentUserId && d.to.userId === m.userId,
              );
              const debtOwesMe = debts.find(
                (d) => d.to.userId === currentUserId && d.from.userId === m.userId,
              );
              const placeholderExistedWhenUserJoined =
                member?.isDummy && currentUserJoinedAt && member.joinedAt <= currentUserJoinedAt;
              const canClaim =
                placeholderExistedWhenUserJoined && currentUserRole !== 'admin' && !userHasClaimed;

              return (
                <div
                  key={m.userId}
                  className="card p-3 rounded-2xl"
                >
                  <div className="flex items-center gap-3">
                    <Avatar avatarKey={m.avatarKey} displayName={m.displayName} size="sm" />
                    <span className="flex-1 font-medium">
                      {member?.isDummy ? `\uD83D\uDC7B ${m.displayName}` : m.displayName}
                      {member?.muted && (
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
                    {canClaim && (
                      <button
                        onClick={() => handleClaimPlaceholder(m.userId, m.displayName)}
                        className="text-xs text-tg-link font-medium ml-1 shrink-0"
                      >
                        {t('placeholder.claimButton')}
                      </button>
                    )}
                  </div>
                  {/* Settle up actions — I owe this person */}
                  {debtIOwe && debtIOwe.amount > 0 && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleSettleUp(debtIOwe, 'ton')}
                        className="flex-1 bg-tg-button text-tg-button-text py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
                      >
                        <IconTon size={14} />
                        {t('group.payUsdt')}
                      </button>
                      <button
                        onClick={() => handleSettleUp(debtIOwe, 'manual')}
                        className="flex-1 text-tg-text py-2 rounded-xl text-sm border border-ghost font-medium"
                      >
                        {t('group.settleManually')}
                      </button>
                    </div>
                  )}
                  {/* Actions — this person owes me */}
                  {debtOwesMe && debtOwesMe.amount > 0 && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleSettleUp(debtOwesMe, 'manual')}
                        className="flex-1 text-tg-hint py-2 rounded-xl text-sm border border-ghost"
                      >
                        {t('group.markAsSettled')}
                      </button>
                      {member?.isDummy ? (
                        <button
                          onClick={() =>
                            sharePersonalizedInviteLink(
                              group.inviteCode,
                              m.userId,
                              group.name,
                              m.displayName,
                            )
                          }
                          className="flex-1 text-tg-link py-2 rounded-xl text-sm border border-ghost"
                        >
                          {t('group.invite')}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSendReminder(debtOwesMe)}
                          className="flex-1 text-tg-link py-2 rounded-xl text-sm border border-ghost"
                        >
                          {t('group.sendReminder')}
                        </button>
                      )}
                    </div>
                  )}
                  {/* Invite button for placeholders with no debt relationship */}
                  {member?.isDummy && !debtIOwe && !debtOwesMe && (
                    <button
                      onClick={() =>
                        sharePersonalizedInviteLink(
                          group.inviteCode,
                          m.userId,
                          group.name,
                          m.displayName,
                        )
                      }
                      className="mt-3 w-full text-tg-link py-2 rounded-xl text-sm border border-ghost"
                    >
                      {t('group.invite')}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-4">
          {statsLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-tg-hint/30 border-t-tg-hint rounded-full animate-spin" />
            </div>
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
              <div className="card rounded-2xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-tg-hint text-sm">{t('group.statsTotalSpent')}</span>
                  <span className="font-extrabold text-lg">
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
                  <span className="font-extrabold text-lg">
                    {formatAmount(stats.yourShare, group?.currency)}
                  </span>
                </div>
              </div>

              {/* Additional stats */}
              <div>
                <div className="text-xs font-medium text-tg-hint uppercase tracking-label mb-2">
                  {t('group.statsAdditional')}
                </div>
                <div className="card rounded-2xl space-y-2">
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

              {/* CSV export */}
              <button
                onClick={handleExportCsv}
                className="w-full py-3 text-sm text-tg-link font-medium"
              >
                {t('group.exportCsv')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Add Expense FAB */}
      {tab === 'transactions' && (
        <button
          onClick={() => navigate(`/groups/${groupId}/add-expense`)}
          className={`fixed right-6 bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white px-6 py-3 rounded-full shadow-glow font-medium ${showWelcomeBanner ? 'animate-pulse' : ''}`}
          style={{ bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))' }}
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
              <div className="text-xs font-medium text-tg-hint uppercase tracking-label mb-2">
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
              <div className="text-sm text-tg-text card rounded-xl px-3 py-2">
                {selectedExpense.comment}
              </div>
            )}

            {/* Receipt */}
            {selectedExpense.receiptThumbKey && (
              <button
                onClick={() => {
                  setViewImageKey(selectedExpense.receiptKey);
                  setSelectedExpense(null);
                }}
              >
                <img
                  src={imageUrl(selectedExpense.receiptThumbKey)}
                  alt="Receipt"
                  className="w-20 h-20 rounded-xl object-cover border border-ghost"
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
                    className="flex-1 py-2 rounded-xl text-sm font-medium text-tg-link border border-ghost"
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
                <button
                  onClick={(e) => openExternalLink(selectedSettlement.explorerUrl!, e)}
                  className="inline-flex items-center gap-1 text-sm text-tg-link underline"
                >
                  <IconTon size={14} />
                  {t('settlement.viewTransaction')}
                </button>
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
                  setViewImageKey(selectedSettlement.receiptKey);
                  setSelectedSettlement(null);
                }}
                className="mx-auto block"
              >
                <img
                  src={imageUrl(selectedSettlement.receiptThumbKey)}
                  alt="Receipt"
                  className="w-20 h-20 rounded-xl object-cover border border-ghost"
                />
              </button>
            )}

            <div className="text-xs text-tg-hint text-center">
              {timeAgo(selectedSettlement.createdAt)}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Image viewer (receipts, group avatar) */}
      <ImageViewer
        imageKey={viewImageKey}
        open={!!viewImageKey}
        onClose={() => setViewImageKey(null)}
      />

      {/* Claim placeholder prompt */}
      <BottomSheet
        open={showClaimPrompt}
        onClose={() => setShowClaimPrompt(false)}
        title={t('placeholder.claimBanner')}
      >
        <div className="space-y-3">
          {group.members
            .filter((m) => m.isDummy && (!currentUserJoinedAt || m.joinedAt <= currentUserJoinedAt))
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
                  className="w-full flex items-center justify-between p-3 card rounded-2xl"
                >
                  <div className="flex items-center gap-2">
                    <span>{'\uD83D\uDC7B'}</span>
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
