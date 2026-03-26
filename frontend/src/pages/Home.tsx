import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type GroupSummary } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { formatAmount, formatSignedAmount } from '../utils/format';
import { getCurrency } from '../utils/currencies';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { BottomSheet } from '../components/BottomSheet';
import { CurrencyPicker, CurrencyButton } from '../components/CurrencyPicker';
import { Avatar } from '../components/Avatar';

function computeNetUsd(
  balancesByCurrency: Record<string, { owed: number; owe: number }>,
  rates: Record<string, number>,
): number | null {
  let net = 0;
  for (const [currency, bal] of Object.entries(balancesByCurrency)) {
    const rate = currency === 'USD' ? 1 : rates[currency];
    if (!rate || rate <= 0) return null; // can't convert
    net += (bal.owed - bal.owe) / rate;
  }
  return Math.round(net);
}

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
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);

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
      navigate(`/groups/${group.id}?created=1`, { replace: true });
    } catch (err) {
      console.error('Failed to create group:', err);
    } finally {
      setCreating(false);
    }
  }

  // Fetch exchange rates when user has balances in multiple currencies
  const currencies = new Set(groups.map((g) => g.currency || 'USD'));
  useEffect(() => {
    if (currencies.size > 1 && !exchangeRates) {
      api
        .getExchangeRates()
        .then((data) => setExchangeRates(data.rates))
        .catch(() => {}); // silent fail — total just won't show
    }
  }, [currencies.size, exchangeRates]);

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
  const currencyCount = Object.keys(balancesByCurrency).length;
  const netUsd =
    currencyCount > 1 && exchangeRates ? computeNetUsd(balancesByCurrency, exchangeRates) : null;

  if (loading) return <LoadingScreen />;

  return (
    <PageLayout>
      {/* Balance Summary */}
      <div className="mb-6">
        <h1 className="text-xl font-bold mb-3">{t('tabs.groups')}</h1>
        {hasBalances && (
          <div className="flex gap-2 items-center text-sm flex-wrap">
            {Object.entries(balancesByCurrency).map(([currency, bal]) => (
              <div key={currency} className="flex gap-1">
                {bal.owed > 0 && (
                  <div className="bg-app-positive-bg px-3 py-2 rounded-lg">
                    <span className="text-app-positive font-medium">
                      +{formatAmount(bal.owed, currency)}
                    </span>
                  </div>
                )}
                {bal.owe > 0 && (
                  <div className="bg-app-negative-bg px-3 py-2 rounded-lg">
                    <span className="text-app-negative font-medium">
                      -{formatAmount(bal.owe, currency)}
                    </span>
                  </div>
                )}
              </div>
            ))}
            {netUsd !== null && netUsd !== 0 && (
              <span className="text-tg-hint text-xs whitespace-nowrap">
                ≈&nbsp;{formatSignedAmount(netUsd, 'USD')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Group List */}
      {groups.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-tg-hint mb-4">{t('home.noGroups')}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white px-6 py-3 rounded-xl font-semibold"
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
              className="w-full text-left card p-4 rounded-2xl"
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
                      {' · '}
                      {getCurrency(group.currency).symbol}
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
          className="fixed right-6 bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white px-6 py-3 rounded-full shadow-glow font-semibold"
          style={{ bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))' }}
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
          className="w-full p-3 rounded-xl mb-4 bg-app-card-nested border border-ghost"
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
            className="flex-1 p-3 rounded-xl bg-app-card-nested text-tg-text"
          >
            {t('createGroup.cancel')}
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={creating || !newGroupName.trim()}
            className="flex-1 p-3 rounded-xl bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white font-semibold disabled:opacity-50"
          >
            {creating ? t('createGroup.creating') : t('createGroup.create')}
          </button>
        </div>
      </BottomSheet>
    </PageLayout>
  );
}
