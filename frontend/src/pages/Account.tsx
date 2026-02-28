import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserProfile } from '../services/api';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessBanner } from '../components/SuccessBanner';
import { BottomSheet } from '../components/BottomSheet';
import { Avatar } from '../components/Avatar';
import { validateImageFile, processAvatar } from '../utils/image';

const LANGUAGES = [
  { code: 'en', flag: '\u{1F1EC}\u{1F1E7}', name: 'English' },
  { code: 'ru', flag: '\u{1F1F7}\u{1F1FA}', name: 'Русский' },
  { code: 'es', flag: '\u{1F1EA}\u{1F1F8}', name: 'Español' },
  { code: 'hi', flag: '\u{1F1EE}\u{1F1F3}', name: 'हिन्दी' },
  { code: 'id', flag: '\u{1F1EE}\u{1F1E9}', name: 'Bahasa Indonesia' },
  { code: 'fa', flag: '\u{1F1EE}\u{1F1F7}', name: 'فارسی' },
  { code: 'pt', flag: '\u{1F1E7}\u{1F1F7}', name: 'Português' },
  { code: 'uk', flag: '\u{1F1FA}\u{1F1E6}', name: 'Українська' },
  { code: 'de', flag: '\u{1F1E9}\u{1F1EA}', name: 'Deutsch' },
  { code: 'it', flag: '\u{1F1EE}\u{1F1F9}', name: 'Italiano' },
  { code: 'vi', flag: '\u{1F1FB}\u{1F1F3}', name: 'Tiếng Việt' },
] as const;

export function Account() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected
    e.target.value = '';

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploadingAvatar(true);
    setError(null);
    try {
      const processed = await processAvatar(file);
      const result = await api.uploadAvatar(processed.blob);
      setUser((prev) => (prev ? { ...prev, avatarKey: result.avatarKey } : prev));
      setSuccess(t('account.avatarUpdated'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleAvatarDelete() {
    if (!user?.avatarKey) return;
    setError(null);
    try {
      await api.deleteAvatar();
      setUser((prev) => (prev ? { ...prev, avatarKey: null } : prev));
      setSuccess(t('account.avatarRemoved'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to remove avatar');
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">{t('account.title')}</h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess(null)} />}

      {/* Avatar */}
      <div className="flex flex-col items-center mb-6">
        <div className="relative">
          <Avatar avatarKey={user?.avatarKey} displayName={user?.displayName ?? ''} size="lg" />
          {uploadingAvatar && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="text-tg-link text-sm font-medium disabled:opacity-50"
          >
            {user?.avatarKey ? t('account.changePhoto') : t('account.addPhoto')}
          </button>
          {user?.avatarKey && (
            <button
              onClick={handleAvatarDelete}
              className="text-tg-destructive text-sm font-medium"
            >
              {t('account.removePhoto')}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarUpload}
          className="hidden"
        />
      </div>

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
