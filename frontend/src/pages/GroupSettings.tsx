import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type GroupDetail, ApiError } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { resolveCurrentUser } from '../hooks/useCurrentUser';
import { shareInviteLink } from '../utils/share';
import { CurrencyPicker, CurrencyButton } from '../components/CurrencyPicker';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessBanner } from '../components/SuccessBanner';

export function GroupSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const groupId = parseInt(id ?? '', 10);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  useTelegramBackButton(true);

  useEffect(() => {
    if (isNaN(groupId)) return;
    api
      .getGroup(groupId)
      .then((data) => {
        setGroup(data);
        setName(data.name);
        setCurrency(data.currency);
        setMuted(data.muted);

        const user = resolveCurrentUser(data.members);
        if (user) {
          setCurrentUserId(user.userId);
          setCurrentUserRole(user.role);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [groupId]);

  const isAdmin = currentUserRole === 'admin';
  const hasChanges = group && (name !== group.name || currency !== group.currency);

  async function handleSave() {
    if (!hasChanges || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updates: { name?: string; currency?: string } = {};
      if (name !== group!.name) updates.name = name;
      if (currency !== group!.currency) updates.currency = currency;
      await api.updateGroup(groupId, updates);
      setGroup((prev) => (prev ? { ...prev, ...updates } : prev));
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateInvite() {
    if (!confirm('Generate a new invite link? The old link will stop working.')) return;
    setError(null);
    try {
      const result = await api.regenerateInvite(groupId);
      setGroup((prev) => (prev ? { ...prev, inviteCode: result.inviteCode } : prev));
      setSuccess('Invite link regenerated');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate invite');
    }
  }

  function handleShareInvite() {
    if (!group) return;
    shareInviteLink(group.inviteCode, group.name);
  }

  async function handleDeleteGroup() {
    if (!confirm(`Delete "${group?.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.deleteGroup(groupId);
      navigate('/', { replace: true });
    } catch (err: any) {
      if (err instanceof ApiError && err.errorCode === 'outstanding_balances') {
        if (confirm('Group has unsettled balances. Delete anyway?')) {
          try {
            await api.deleteGroup(groupId, true);
            navigate('/', { replace: true });
          } catch (err2: any) {
            setError(err2.message || 'Failed to delete group');
          }
        }
      } else {
        setError(err.message || 'Failed to delete group');
      }
    }
  }

  async function handleLeaveGroup() {
    if (!confirm(`Leave "${group?.name}"?`)) return;
    setError(null);
    try {
      await api.leaveGroup(groupId);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to leave group');
    }
  }

  if (loading || !group) return <LoadingScreen />;

  const creator = group.members.find((m) => m.role === 'admin');

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">Group Settings</h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess(null)} />}

      {/* Group name */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Group name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-transparent"
          disabled={!isAdmin}
        />
      </div>

      {/* Currency */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Currency
        </label>
        <CurrencyButton
          value={currency}
          onClick={() => setShowCurrencyPicker(true)}
          disabled={!isAdmin}
        />
        <CurrencyPicker
          open={showCurrencyPicker}
          onClose={() => setShowCurrencyPicker(false)}
          value={currency}
          onSelect={(code) => setCurrency(code)}
        />
      </div>

      {/* Save button */}
      {isAdmin && hasChanges && (
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full mb-6 bg-blue-500 text-white py-3 rounded-xl font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      )}

      {/* Invite link */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Invite link
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleShareInvite}
            className="flex-1 p-3 border border-blue-500 text-blue-500 rounded-xl text-sm font-medium"
          >
            Share Invite
          </button>
          {isAdmin && (
            <button
              onClick={handleRegenerateInvite}
              className="p-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-500"
            >
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="mb-6">
        <button
          onClick={async () => {
            try {
              const result = await api.toggleMute(groupId);
              setMuted(result.muted);
            } catch (err: any) {
              setError(err.message || 'Failed to toggle notifications');
            }
          }}
          className="w-full flex justify-between items-center p-3 border border-gray-200 dark:border-gray-600 rounded-xl"
        >
          <span className="text-sm font-medium">Notifications</span>
          <span className={`text-sm ${muted ? 'text-red-500' : 'text-green-500'}`}>
            {muted ? 'Muted' : 'On'}
          </span>
        </button>
      </div>

      {/* Members */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2 text-gray-600 dark:text-gray-400">
          Members ({group.members.length})
        </label>
        <div className="space-y-2">
          {group.members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{m.displayName}</span>
                {m.role === 'admin' && (
                  <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded-full">
                    &#9812; Admin
                  </span>
                )}
                {m.userId === currentUserId && <span className="text-xs text-gray-400">you</span>}
              </div>
              {m.username && <span className="text-sm text-gray-400">@{m.username}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Created by */}
      {creator && (
        <div className="text-sm text-gray-500 mb-6">Created by {creator.displayName}</div>
      )}

      {/* Danger zone */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        {isAdmin ? (
          <button
            onClick={handleDeleteGroup}
            className="w-full p-3 border border-red-500 text-red-500 rounded-xl font-medium"
          >
            Delete Group
          </button>
        ) : (
          <button
            onClick={handleLeaveGroup}
            className="w-full p-3 border border-red-500 text-red-500 rounded-xl font-medium"
          >
            Leave Group
          </button>
        )}
      </div>
    </PageLayout>
  );
}
