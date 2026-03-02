import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type GroupSummary } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { formatAmount, formatSignedAmount } from '../utils/format';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { BottomSheet } from '../components/BottomSheet';
import { CurrencyPicker, CurrencyButton } from '../components/CurrencyPicker';
import { Avatar } from '../components/Avatar';

export function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newGroupCurrency, setNewGroupCurrency] = useState('USD');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  useTelegramBackButton(false);

  const loadGroups = useCallback(async () => {
    try {
      const data = await api.listGroups();
      setGroups(data.groups);
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setCreating(true);
    try {
      const group = await api.createGroup(newGroupName.trim(), newGroupCurrency);
      setShowCreate(false);
      setNewGroupName('');
      setNewGroupCurrency('USD');
      navigate(`/groups/${group.id}`, { replace: true });
    } catch (err) {
      console.error('Failed to create group:', err);
    } finally {
      setCreating(false);
    }
  }

  // A2: Group balances by currency
  const balancesByCurrency = groups.reduce<Record<string, { owed: number; owe: number }>>(
    (acc, g) => {
      const cur = g.currency || 'USD';
      if (!acc[cur]) acc[cur] = { owed: 0, owe: 0 };
      if (g.netBalance > 0) acc[cur].owed += g.netBalance;
      if (g.netBalance < 0) acc[cur].owe += Math.abs(g.netBalance);
      return acc;
    },
    {},
  );
  const hasBalances = Object.values(balancesByCurrency).some((b) => b.owed > 0 || b.owe > 0);

  if (loading) return <LoadingScreen />;

  return (
    <PageLayout>
      {/* Balance Summary */}
      <div className="mb-6">
        <h1 className="text-xl font-bold mb-3">{t('app.title')}</h1>
        {hasBalances && (
          <div className="flex gap-4 text-sm flex-wrap">
            {Object.entries(balancesByCurrency).map(([currency, bal]) => (
              <div key={currency} className="flex gap-2">
                {bal.owed > 0 && (
                  <div className="bg-app-positive-bg px-3 py-2 rounded-lg">
                    <span className="text-app-positive font-medium">
                      {t('home.owedToYou', { amount: formatAmount(bal.owed, currency) })}
                    </span>
                  </div>
                )}
                {bal.owe > 0 && (
                  <div className="bg-app-negative-bg px-3 py-2 rounded-lg">
                    <span className="text-app-negative font-medium">
                      {t('home.youOwe', { amount: formatAmount(bal.owe, currency) })}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Group List */}
      {groups.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-tg-hint mb-4">{t('home.noGroups')}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-tg-button text-tg-button-text px-6 py-3 rounded-xl font-medium"
          >
            {t('home.createFirst')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => navigate(`/groups/${group.id}`)}
              className="w-full text-left bg-tg-section p-4 rounded-xl shadow-sm border border-tg-separator"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Avatar
                    avatarKey={group.avatarKey}
                    emoji={group.avatarEmoji}
                    displayName={group.name}
                    size="md"
                  />
                  <div>
                    <div className="font-medium">{group.name}</div>
                    <div className="text-sm text-tg-hint">
                      {t('home.member', { count: group.memberCount })}
                    </div>
                  </div>
                </div>
                {group.netBalance !== 0 && (
                  <div
                    className={`text-sm font-medium ${
                      group.netBalance > 0 ? 'text-app-positive' : 'text-app-negative'
                    }`}
                  >
                    {formatSignedAmount(group.netBalance, group.currency)}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create Group FAB */}
      {groups.length > 0 && !showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="fixed bottom-20 right-6 bg-tg-button text-tg-button-text px-6 py-3 rounded-full shadow-lg font-medium"
        >
          {t('home.addGroup')}
        </button>
      )}

      {/* Create Group Bottom Sheet */}
      <BottomSheet
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setNewGroupName('');
        }}
        title={t('createGroup.title')}
      >
        <input
          type="text"
          placeholder={t('createGroup.placeholder')}
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
          className="w-full p-3 border border-tg-separator rounded-xl mb-4 bg-transparent"
          autoFocus
          maxLength={100}
        />
        <div className="mb-4">
          <CurrencyButton value={newGroupCurrency} onClick={() => setShowCurrencyPicker(true)} />
        </div>
        <CurrencyPicker
          open={showCurrencyPicker}
          onClose={() => setShowCurrencyPicker(false)}
          value={newGroupCurrency}
          onSelect={setNewGroupCurrency}
          zIndex={60}
        />
        <div className="flex gap-3">
          <button
            onClick={() => {
              setShowCreate(false);
              setNewGroupName('');
            }}
            className="flex-1 p-3 rounded-xl border border-tg-separator"
          >
            {t('createGroup.cancel')}
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={creating || !newGroupName.trim()}
            className="flex-1 p-3 rounded-xl bg-tg-button text-tg-button-text font-medium disabled:opacity-50"
          >
            {creating ? t('createGroup.creating') : t('createGroup.create')}
          </button>
        </div>
      </BottomSheet>
    </PageLayout>
  );
}
