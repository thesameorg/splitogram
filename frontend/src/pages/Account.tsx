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
import { truncateAddress } from '../utils/ton';
import { useTonWallet } from '../hooks/useTonWallet';
import { useUser } from '../contexts/UserContext';
import { config } from '../config';

declare const __APP_VERSION__: string;

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
  const { user: userCtx, setUser: setUserContext } = useUser();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackFiles, setFeedbackFiles] = useState<File[]>([]);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'warning' | 'groups' | 'confirm'>('warning');
  const [preflightGroups, setPreflightGroups] = useState<
    Array<{
      id: number;
      name: string;
      candidates: Array<{ userId: number; displayName: string }>;
    }>
  >([]);
  const [resolvedGroupIds, setResolvedGroupIds] = useState<Set<number>>(new Set());
  const [selectedAdmins, setSelectedAdmins] = useState<Record<number, number>>({});
  const [actionLoading, setActionLoading] = useState<number | null>(null); // groupId being acted on
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackFileInputRef = useRef<HTMLInputElement>(null);

  const {
    connected: walletConnected,
    rawAddress,
    friendlyAddress,
    openModal,
    disconnect,
    networkMismatch,
    clearNetworkMismatch,
  } = useTonWallet();

  const [walletVersion, setWalletVersion] = useState<string | null>(null);
  const [showBalances, setShowBalances] = useState(false);
  const [tonBalance, setTonBalance] = useState<string | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

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

  // Fetch wallet version from TONAPI when wallet is connected
  useEffect(() => {
    if (!rawAddress) {
      setWalletVersion(null);
      setShowBalances(false);
      setTonBalance(null);
      setUsdtBalance(null);
      return;
    }
    const tonapiBase =
      config.tonNetwork === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io';
    fetch(`${tonapiBase}/v2/accounts/${rawAddress}`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: any) => {
        if (!data?.interfaces) return;
        const ifaces: string[] = data.interfaces;
        if (ifaces.some((i) => i.includes('wallet_v5'))) setWalletVersion('W5');
        else if (ifaces.some((i) => i.includes('wallet_v4'))) setWalletVersion('V4R2');
        else if (ifaces.some((i) => i.includes('wallet_v3'))) setWalletVersion('V3');
        else setWalletVersion(null);
      })
      .catch(() => setWalletVersion(null));
  }, [rawAddress]);

  async function fetchBalances() {
    if (!rawAddress) return;
    setBalancesLoading(true);
    const tonapiBase =
      config.tonNetwork === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io';
    const usdtMaster =
      config.tonNetwork === 'mainnet'
        ? 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
        : 'kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7';
    try {
      const [accRes, jettonRes] = await Promise.all([
        fetch(`${tonapiBase}/v2/accounts/${rawAddress}`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${tonapiBase}/v2/accounts/${rawAddress}/jettons/${usdtMaster}`, {
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      if (accRes.ok) {
        const acc = await accRes.json();
        if ((acc as any).balance != null) {
          const ton = Number((acc as any).balance) / 1e9;
          setTonBalance(ton.toFixed(ton < 0.01 ? 4 : 2));
        }
      }
      if (jettonRes.ok) {
        const jet = await jettonRes.json();
        const decimals = (jet as any).jetton?.decimals ?? 6;
        const usdt = Number((jet as any).balance ?? 0) / Math.pow(10, decimals);
        setUsdtBalance(usdt.toFixed(2));
      } else {
        setUsdtBalance('0');
      }
    } catch {
      setTonBalance(null);
      setUsdtBalance(null);
    } finally {
      setBalancesLoading(false);
    }
  }

  function toggleBalances() {
    if (showBalances) {
      setShowBalances(false);
    } else {
      setShowBalances(true);
      fetchBalances();
    }
  }

  async function handleSave() {
    if (!editName.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateMe({ displayName: editName.trim() });
      setUser((prev) => (prev ? { ...prev, displayName: result.displayName } : prev));
      setUserContext((prev) =>
        prev
          ? { ...prev, displayName: result.displayName }
          : { displayName: result.displayName, avatarKey: null, isAdmin: false },
      );
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
      setUserContext((prev) => (prev ? { ...prev, avatarKey: result.avatarKey } : prev));
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
      setUserContext((prev) => (prev ? { ...prev, avatarKey: null } : prev));
      setSuccess(t('account.avatarRemoved'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to remove avatar');
    }
  }

  async function handleSendFeedback() {
    if (!feedbackText.trim() || sendingFeedback) return;
    setSendingFeedback(true);
    try {
      await api.sendFeedback(
        feedbackText.trim(),
        feedbackFiles.length > 0 ? feedbackFiles : undefined,
      );
      setShowFeedback(false);
      setFeedbackText('');
      setFeedbackFiles([]);
      setSuccess(t('account.feedbackSent'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to send feedback');
    } finally {
      setSendingFeedback(false);
    }
  }

  function handleFeedbackFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    e.target.value = '';
    setFeedbackFiles((prev) => [...prev, ...Array.from(files)].slice(0, 5));
  }

  async function handleDeletePreflight() {
    setError(null);
    setActionLoading(-1); // loading indicator for "Continue" button
    try {
      const result = await api.deletionPreflight();
      if (result.groups.length === 0) {
        setDeleteStep('confirm');
      } else {
        setPreflightGroups(result.groups);
        setResolvedGroupIds(new Set());
        setSelectedAdmins({});
        setDeleteStep('groups');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to check account');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTransferAdmin(groupId: number) {
    const newAdminId = selectedAdmins[groupId];
    if (!newAdminId) return;
    setActionLoading(groupId);
    setError(null);
    try {
      await api.transferAdmin(groupId, newAdminId);
      setResolvedGroupIds((prev) => new Set([...prev, groupId]));
    } catch (err: any) {
      setError(err.message || 'Failed to transfer admin');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeleteGroupForDeletion(groupId: number) {
    setActionLoading(groupId);
    setError(null);
    try {
      await api.deleteGroup(groupId, true);
      setResolvedGroupIds((prev) => new Set([...prev, groupId]));
    } catch (err: any) {
      setError(err.message || 'Failed to delete group');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      // Disconnect TonConnect wallet first to clear browser storage,
      // otherwise the old wallet gets restored on re-registration
      if (walletConnected) {
        try {
          await disconnect();
        } catch {
          // Ignore disconnect errors — deletion should proceed
        }
      }
      await api.deleteAccount();
      setShowDeleteFlow(false);
      setDeleted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to delete account');
      setDeleting(false);
    }
  }

  if (deleted) {
    return (
      <PageLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="text-5xl mb-6">&#128075;</div>
          <h1 className="text-xl font-bold mb-3">{t('account.deletedTitle')}</h1>
          <p className="text-tg-hint text-sm mb-8">{t('account.deletedMessage')}</p>
          <button
            onClick={() => {
              if (window.Telegram?.WebApp?.close) {
                window.Telegram.WebApp.close();
              }
            }}
            className="px-8 py-3 bg-tg-button text-tg-button-text rounded-xl font-medium"
          >
            {t('account.closeApp')}
          </button>
        </div>
      </PageLayout>
    );
  }

  if (loading) return <LoadingScreen />;

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">{t('account.title')}</h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess(null)} />}
      {networkMismatch && (
        <ErrorBanner
          message={t('account.walletNetworkMismatch', {
            network: config.tonNetwork === 'mainnet' ? 'mainnet' : 'testnet',
          })}
          onDismiss={clearNetworkMismatch}
        />
      )}

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
          aria-label={t('account.changePhoto')}
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

      {/* TON Wallet */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">{t('account.wallet')}</label>
        {walletConnected ? (
          <div className="p-3 bg-tg-section rounded-xl border border-tg-separator">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="font-medium">{truncateAddress(friendlyAddress)}</span>
                {walletVersion && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-tg-secondary-bg text-tg-hint">
                    {walletVersion}
                  </span>
                )}
                {config.tonNetwork === 'testnet' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-app-warning-bg text-app-warning">
                    testnet
                  </span>
                )}
                <button
                  onClick={toggleBalances}
                  className="p-1 text-tg-hint hover:text-tg-text transition-colors"
                  title={showBalances ? t('account.hideBalances') : t('account.showBalances')}
                >
                  {showBalances ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                onClick={() => {
                  if (window.confirm(t('account.confirmDisconnectWallet'))) {
                    disconnect();
                  }
                }}
                className="text-tg-destructive text-sm font-medium"
              >
                {t('account.disconnectWallet')}
              </button>
            </div>
            {showBalances && (
              <div className="flex gap-4 mt-2 pt-2 border-t border-tg-separator text-sm">
                {balancesLoading ? (
                  <span className="text-tg-hint">...</span>
                ) : (
                  <>
                    {tonBalance !== null && (
                      <span className="text-tg-hint">
                        <span className="font-medium text-tg-text">{tonBalance}</span> TON
                      </span>
                    )}
                    {usdtBalance !== null && (
                      <span className="text-tg-hint">
                        <span className="font-medium text-tg-text">{usdtBalance}</span> USDT
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={openModal}
            className="w-full p-3 bg-tg-button text-tg-button-text rounded-xl font-medium"
          >
            {t('account.connectWallet')}
          </button>
        )}
      </div>

      {/* Channel */}
      <div className="mb-4">
        <button
          onClick={() => window.Telegram?.WebApp?.openTelegramLink('https://t.me/splitogramm')}
          className="w-full flex justify-between items-center p-3 bg-tg-section rounded-xl border border-tg-separator text-left"
        >
          <span className="font-medium">{t('account.channel')}</span>
          <svg
            className="w-4 h-4 text-tg-hint"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
      </div>

      {/* Legal */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">{t('account.legal')}</label>
        <div className="bg-tg-section rounded-xl border border-tg-separator divide-y divide-tg-separator">
          <button
            onClick={() => window.Telegram?.WebApp?.openLink(`${config.apiBaseUrl}/terms`)}
            className="w-full flex justify-between items-center p-3 text-left"
          >
            <span className="font-medium">{t('account.termsOfService')}</span>
            <svg
              className="w-4 h-4 text-tg-hint"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
          <button
            onClick={() => window.Telegram?.WebApp?.openLink(`${config.apiBaseUrl}/privacy`)}
            className="w-full flex justify-between items-center p-3 text-left"
          >
            <span className="font-medium">{t('account.privacyPolicy')}</span>
            <svg
              className="w-4 h-4 text-tg-hint"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Feedback */}
      <div className="mb-4">
        <button
          onClick={() => setShowFeedback(true)}
          className="w-full p-3 bg-tg-section rounded-xl border border-tg-separator text-left font-medium"
        >
          {t('account.feedback')}
        </button>
      </div>

      {/* Admin Dashboard Link */}
      {userCtx?.isAdmin && (
        <div className="mb-4">
          <button
            onClick={() => {
              const base = config.apiBaseUrl || window.location.origin;
              const url = `${base}/admin`;
              window.Telegram?.WebApp?.openLink?.(url) ?? window.open(url, '_blank');
            }}
            className="w-full p-3 bg-tg-section rounded-xl border border-tg-separator text-left font-medium"
          >
            Admin Dashboard
          </button>
        </div>
      )}

      {/* Delete Account */}
      <div className="mb-4 mt-8">
        <button
          onClick={() => {
            setShowDeleteFlow(true);
            setDeleteStep('warning');
            setPreflightGroups([]);
            setResolvedGroupIds(new Set());
            setSelectedAdmins({});
          }}
          className="w-full p-3 rounded-xl border border-tg-destructive/30 text-tg-destructive text-sm font-medium"
        >
          {t('account.deleteAccount')}
        </button>
      </div>

      {/* Version */}
      <div className="text-center text-xs text-tg-hint/50 mt-2 mb-2">v{__APP_VERSION__}</div>

      {/* DEBUG: Temporary env check — remove next build */}
      {userCtx?.isAdmin && (
        <div className="mt-4 rounded-xl overflow-hidden border border-tg-separator">
          <div className="bg-tg-secondary-bg px-3 py-2 text-xs font-bold text-tg-hint">Debug Info</div>
          <div className="divide-y divide-tg-separator text-xs">
            {[
              ['Analytics token', import.meta.env.VITE_TG_ANALYTICS_TOKEN
                ? `${import.meta.env.VITE_TG_ANALYTICS_TOKEN.slice(0, 20)}...`
                : '(empty)'],
              ['Analytics SDK', (() => {
                const ta = (window as any).telegramAnalytics;
                if (!ta) return 'not loaded';
                return `loaded (keys: ${Object.keys(ta).join(', ')})`;
              })()],
              ['Worker URL', import.meta.env.VITE_WORKER_URL || '(empty)'],
              ['Bot username', import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '(empty)'],
              ['TON network', import.meta.env.VITE_TON_NETWORK || '(empty)'],
              ['Build mode', `${import.meta.env.MODE} (prod=${import.meta.env.PROD})`],
              ['TG WebApp', window.Telegram?.WebApp ? 'loaded' : 'missing'],
              ['TG version', (window.Telegram?.WebApp as any)?.version ?? 'n/a'],
              ['TG platform', (window.Telegram?.WebApp as any)?.platform ?? 'n/a'],
              ['TG initData', window.Telegram?.WebApp?.initData
                ? `${window.Telegram.WebApp.initData.length} chars`
                : '(empty)'],
              ['TonConnect', (() => {
                try {
                  const tc = (window as any).tonConnectUI;
                  if (tc) return `instance found, connected=${tc.connected}`;
                  return 'no global instance';
                } catch { return 'error checking'; }
              })()],
              ['Wallet', walletConnected
                ? `${walletVersion ?? '?'} ${friendlyAddress?.slice(0, 8)}...`
                : 'not connected'],
              ['User agent', navigator.userAgent.slice(0, 60) + '...'],
              ['Screen', `${window.innerWidth}x${window.innerHeight} (dpr ${window.devicePixelRatio})`],
              ['Locale', `${navigator.language} / i18n=${i18n.language}`],
              ['Time', new Date().toISOString()],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-2 px-3 py-2">
                <span className="text-tg-hint shrink-0">{label}</span>
                <span className="text-tg-text text-right break-all font-mono">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Delete Account Flow */}
      <BottomSheet
        open={showDeleteFlow}
        onClose={() => {
          if (!deleting) {
            setShowDeleteFlow(false);
          }
        }}
        title={t('account.deleteAccount')}
      >
        <div className="space-y-4">
          {deleteStep === 'warning' && (
            <>
              <p className="text-sm text-tg-hint">{t('account.deleteWarning')}</p>
              <button
                onClick={handleDeletePreflight}
                disabled={actionLoading === -1}
                className="w-full py-3 rounded-xl bg-tg-destructive text-white font-medium disabled:opacity-50"
              >
                {actionLoading === -1 ? '...' : t('account.deleteContinue')}
              </button>
              <button
                onClick={() => setShowDeleteFlow(false)}
                className="w-full py-3 rounded-xl border border-tg-separator font-medium"
              >
                {t('account.cancel')}
              </button>
            </>
          )}

          {deleteStep === 'groups' && (
            <>
              <p className="text-sm text-tg-hint font-medium">
                {t('account.deleteGroupsSubtitle')}
              </p>

              <div className="space-y-3">
                {preflightGroups.map((group) => {
                  const resolved = resolvedGroupIds.has(group.id);
                  const isLoading = actionLoading === group.id;

                  return (
                    <div
                      key={group.id}
                      className={`p-3 rounded-xl border ${resolved ? 'border-app-positive/30 bg-app-positive-bg' : 'border-tg-separator bg-tg-section'}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{group.name}</span>
                        {resolved && (
                          <span className="text-app-positive text-xs font-medium">&#10003;</span>
                        )}
                      </div>

                      {!resolved && (
                        <>
                          {group.candidates.length > 0 ? (
                            <div className="flex gap-2">
                              <select
                                value={selectedAdmins[group.id] ?? ''}
                                onChange={(e) =>
                                  setSelectedAdmins((prev) => ({
                                    ...prev,
                                    [group.id]: parseInt(e.target.value, 10),
                                  }))
                                }
                                className="flex-1 p-2 text-sm rounded-lg border border-tg-separator bg-transparent"
                              >
                                <option value="">{t('account.selectNewAdmin')}</option>
                                {group.candidates.map((c) => (
                                  <option key={c.userId} value={c.userId}>
                                    {c.displayName}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleTransferAdmin(group.id)}
                                disabled={!selectedAdmins[group.id] || isLoading}
                                className="px-3 py-2 text-sm rounded-lg bg-tg-button text-tg-button-text font-medium disabled:opacity-50"
                              >
                                {isLoading ? '...' : t('account.transferAdmin')}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDeleteGroupForDeletion(group.id)}
                              disabled={isLoading}
                              className="w-full py-2 text-sm rounded-lg border border-tg-destructive/30 text-tg-destructive font-medium disabled:opacity-50"
                            >
                              {isLoading ? '...' : t('account.deleteGroupButton')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setDeleteStep('confirm')}
                disabled={resolvedGroupIds.size < preflightGroups.length}
                className="w-full py-3 rounded-xl bg-tg-destructive text-white font-medium disabled:opacity-50"
              >
                {t('account.deleteContinue')}
              </button>
              <button
                onClick={() => setShowDeleteFlow(false)}
                className="w-full py-3 rounded-xl border border-tg-separator font-medium"
              >
                {t('account.cancel')}
              </button>
            </>
          )}

          {deleteStep === 'confirm' && (
            <>
              <p className="text-sm text-tg-destructive font-medium">
                {t('account.deleteFinalWarning')}
              </p>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="w-full py-3 rounded-xl bg-tg-destructive text-white font-medium disabled:opacity-50"
              >
                {deleting ? '...' : t('account.deleteConfirmFinal')}
              </button>
              {!deleting && (
                <button
                  onClick={() => setShowDeleteFlow(false)}
                  className="w-full py-3 rounded-xl border border-tg-separator font-medium"
                >
                  {t('account.cancel')}
                </button>
              )}
            </>
          )}
        </div>
      </BottomSheet>

      {/* Feedback Bottom Sheet */}
      <BottomSheet
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
        title={t('account.feedback')}
      >
        <div className="space-y-4">
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t('account.feedbackPlaceholder')}
            className="w-full p-3 border border-tg-separator rounded-xl bg-transparent resize-none h-32"
            maxLength={2000}
          />

          {/* Attachments */}
          {feedbackFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {feedbackFiles.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2 py-1 bg-tg-section rounded-lg border border-tg-separator text-xs"
                >
                  <span className="truncate max-w-[120px]">{file.name}</span>
                  <button
                    onClick={() => setFeedbackFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="text-tg-destructive font-bold"
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {feedbackFiles.length < 5 && (
              <button
                onClick={() => feedbackFileInputRef.current?.click()}
                className="px-4 py-3 border border-dashed border-tg-separator rounded-xl text-sm text-tg-hint"
                aria-label="Attach file"
              >
                📎
              </button>
            )}
            <button
              onClick={handleSendFeedback}
              disabled={sendingFeedback || !feedbackText.trim()}
              className="flex-1 bg-tg-button text-tg-button-text py-3 rounded-xl font-medium disabled:opacity-50"
            >
              {sendingFeedback ? '...' : t('account.feedbackSend')}
            </button>
          </div>
          <input
            ref={feedbackFileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx,.txt"
            onChange={handleFeedbackFileSelect}
            className="hidden"
            aria-label="Attach file"
          />
        </div>
      </BottomSheet>
    </PageLayout>
  );
}
