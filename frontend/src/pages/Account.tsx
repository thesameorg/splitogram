import { useState, useEffect } from 'react';
import { api, type UserProfile } from '../services/api';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessBanner } from '../components/SuccessBanner';

export function Account() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        setUser(data);
        setEditName(data.displayName);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!editName.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateMe({ displayName: editName.trim() });
      setUser((prev) => (prev ? { ...prev, displayName: result.displayName } : prev));
      setEditing(false);
      setSuccess('Name updated');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to update name');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">Account</h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess(null)} />}

      {/* Display Name */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Display name
        </label>
        {editing ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="flex-1 p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-transparent"
              autoFocus
              maxLength={64}
            />
            <button
              onClick={handleSave}
              disabled={saving || !editName.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-xl font-medium disabled:opacity-50"
            >
              {saving ? '...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditName(user?.displayName ?? '');
              }}
              className="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex justify-between items-center p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
            <span className="font-medium">{user?.displayName}</span>
            <button onClick={() => setEditing(true)} className="text-blue-500 text-sm font-medium">
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Username */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
          Telegram username
        </label>
        <div className="p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 text-gray-500">
          {user?.username ? `@${user.username}` : 'No username set'}
        </div>
      </div>
    </PageLayout>
  );
}
