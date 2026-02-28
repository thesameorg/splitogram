import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GroupSummary } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { formatAmount, formatSignedAmount } from '../utils/format';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { BottomSheet } from '../components/BottomSheet';
import { CurrencyPicker, CurrencyButton } from '../components/CurrencyPicker';

export function Home() {
  const navigate = useNavigate();
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

  const totalOwed = groups.reduce((sum, g) => (g.netBalance > 0 ? sum + g.netBalance : sum), 0);
  const totalOwe = groups.reduce(
    (sum, g) => (g.netBalance < 0 ? sum + Math.abs(g.netBalance) : sum),
    0,
  );

  if (loading) return <LoadingScreen />;

  return (
    <PageLayout>
      {/* Balance Summary */}
      <div className="mb-6">
        <h1 className="text-xl font-bold mb-3">Splitogram</h1>
        {(totalOwed > 0 || totalOwe > 0) && (
          <div className="flex gap-4 text-sm">
            {totalOwed > 0 && (
              <div className="bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
                <span className="text-green-600 dark:text-green-400 font-medium">
                  Owed to you: {formatAmount(totalOwed)}
                </span>
              </div>
            )}
            {totalOwe > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                <span className="text-red-600 dark:text-red-400 font-medium">
                  You owe: {formatAmount(-totalOwe)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Group List */}
      {groups.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No groups yet</p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-500 text-white px-6 py-3 rounded-xl font-medium"
          >
            Create your first group
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => navigate(`/groups/${group.id}`)}
              className="w-full text-left bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{group.name}</div>
                  <div className="text-sm text-gray-500">
                    {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                  </div>
                </div>
                {group.netBalance !== 0 && (
                  <div
                    className={`text-sm font-medium ${
                      group.netBalance > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
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
          className="fixed bottom-20 right-6 bg-blue-500 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl"
        >
          +
        </button>
      )}

      {/* Create Group Bottom Sheet */}
      <BottomSheet
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setNewGroupName('');
        }}
        title="Create Group"
      >
        <input
          type="text"
          placeholder="Group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
          className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl mb-4 bg-transparent"
          autoFocus
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
            className="flex-1 p-3 rounded-xl border border-gray-200 dark:border-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={creating || !newGroupName.trim()}
            className="flex-1 p-3 rounded-xl bg-blue-500 text-white font-medium disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </BottomSheet>
    </PageLayout>
  );
}
