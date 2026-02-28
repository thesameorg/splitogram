import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserProfile } from '../services/api';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessBanner } from '../components/SuccessBanner';
import { BottomSheet } from '../components/BottomSheet';

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', name: 'English' },
  { code: 'ru', flag: '🇷🇺', name: 'Русский' },
  { code: 'es', flag: '🇪🇸', name: 'Español' },
  { code: 'hi', flag: '🇮🇳', name: 'हिन्दी' },
  { code: 'id', flag: '🇮🇩', name: 'Bahasa Indonesia' },
  { code: 'fa', flag: '🇮🇷', name: 'فارسی' },
  { code: 'pt', flag: '🇧🇷', name: 'Português' },
  { code: 'uk', flag: '🇺🇦', name: 'Українська' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
  { code: 'it', flag: '🇮🇹', name: 'Italiano' },
  { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt' },
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
  const [showLangPicker, setShowLangPicker] = useState(false);

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

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
        <button
          onClick={() => setShowLangPicker(true)}
          className="w-full flex justify-between items-center p-3 bg-tg-section rounded-xl border border-tg-separator"
        >
          <span className="flex items-center gap-2">
            <span>{currentLang.flag}</span>
            <span className="font-medium">{currentLang.name}</span>
          </span>
          <span className="text-tg-hint">&#9662;</span>
        </button>
      </div>

      {/* Language Picker Bottom Sheet */}
      <BottomSheet
        open={showLangPicker}
        onClose={() => setShowLangPicker(false)}
        title={t('account.language')}
      >
        <div className="overflow-y-auto max-h-[60vh] -mx-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                i18n.changeLanguage(lang.code);
                setShowLangPicker(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left ${
                i18n.language === lang.code ? 'bg-tg-button/10' : ''
              }`}
            >
              <span className="text-xl">{lang.flag}</span>
              <span className="font-medium flex-1">{lang.name}</span>
              {i18n.language === lang.code && (
                <span className="text-tg-link font-bold">&#10003;</span>
              )}
            </button>
          ))}
        </div>
      </BottomSheet>
    </PageLayout>
  );
}
