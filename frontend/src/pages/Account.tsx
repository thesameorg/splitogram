import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserProfile } from '../services/api';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessBanner } from '../components/SuccessBanner';

const LANGUAGES = [
  { code: 'en', label: 'account.languageEn' },
  { code: 'ru', label: 'account.languageRu' },
  { code: 'es', label: 'account.languageEs' },
] as const;

export function Account() {
  const { t, i18n } = useTranslation();
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
      setSuccess(t('account.nameUpdated'));
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
      <h1 className="text-xl font-bold mb-6">{t('account.title')}</h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess(null)} />}

      {/* Display Name */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('account.displayName')}
        </label>
        {editing ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="flex-1 p-3 border border-tg-separator rounded-xl bg-transparent"
              autoFocus
              maxLength={64}
            />
            <button
              onClick={handleSave}
              disabled={saving || !editName.trim()}
              className="px-4 py-2 bg-tg-button text-tg-button-text rounded-xl font-medium disabled:opacity-50"
            >
              {saving ? '...' : t('account.save')}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditName(user?.displayName ?? '');
              }}
              className="px-4 py-2 border border-tg-separator rounded-xl"
            >
              {t('account.cancel')}
            </button>
          </div>
        ) : (
          <div className="flex justify-between items-center p-3 bg-tg-section rounded-xl border border-tg-separator">
            <span className="font-medium">{user?.displayName}</span>
            <button onClick={() => setEditing(true)} className="text-tg-link text-sm font-medium">
              {t('account.edit')}
            </button>
          </div>
        )}
      </div>

      {/* Username */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('account.telegramUsername')}
        </label>
        <div className="p-3 bg-tg-section rounded-xl border border-tg-separator text-tg-hint">
          {user?.username ? `@${user.username}` : t('account.noUsername')}
        </div>
      </div>

      {/* Language Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('account.language')}
        </label>
        <div className="flex gap-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 p-3 rounded-xl text-sm font-medium border ${
                i18n.language === lang.code
                  ? 'bg-tg-button text-tg-button-text border-tg-button'
                  : 'bg-transparent border-tg-separator'
              }`}
            >
              {t(lang.label)}
            </button>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
