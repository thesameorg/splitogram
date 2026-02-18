import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GroupSummary } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';

function formatAmount(microUsdt: number): string {
  const usdt = microUsdt / 1_000_000;
  if (usdt === 0) return '$0.00';
  return usdt > 0 ? `+$${usdt.toFixed(2)}` : `-$${Math.abs(usdt).toFixed(2)}`;
}

export function Home() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);

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
      const group = await api.createGroup(newGroupName.trim());
      setShowCreate(false);
      setNewGroupName('');
      navigate(`/groups/${group.id}`);
    } catch (err) {
      console.error('Failed to create group:', err);
    } finally {
      setCreating(false);
    }
  }

  const totalOwed = groups.reduce((sum, g) => (g.netBalance > 0 ? sum + g.netBalance : sum), 0);
  const totalOwe = groups.reduce((sum, g) => (g.netBalance < 0 ? sum + Math.abs(g.netBalance) : sum), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24">
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
                  <div className="text-sm text-gray-500">{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</div>
                </div>
                {group.netBalance !== 0 && (
                  <div
                    className={`text-sm font-medium ${
                      group.netBalance > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatAmount(group.netBalance)}
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
          className="fixed bottom-6 right-6 bg-blue-500 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl"
        >
          +
        </button>
      )}

      {/* Create Group Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white dark:bg-gray-800 w-full rounded-t-2xl p-6">
            <h2 className="text-lg font-bold mb-4">Create Group</h2>
            <input
              type="text"
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
              className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl mb-4 bg-transparent"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCreate(false); setNewGroupName(''); }}
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
          </div>
        </div>
      )}
    </div>
  );
}
