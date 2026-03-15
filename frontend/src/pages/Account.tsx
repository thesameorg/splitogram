import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserProfile } from '../services/api';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessBanner } from '../components/SuccessBanner';
import { BottomSheet } from '../components/BottomSheet';
import { ImageViewer } from '../components/ImageViewer';
import {
  ProfileSection,
  WalletSection,
  PaymentInfoSection,
  LinksSection,
  DeleteAccountSheet,
  FeedbackSheet,
  DebugPanel,
} from '../components/account';
import { validateImageFile, processAvatar, processPaymentQr } from '../utils/image';
import { useTonWallet } from '../hooks/useTonWallet';
import { useSuccessMessage } from '../hooks/useSuccessMessage';
import { useUser } from '../contexts/UserContext';
import { config } from '../config';
import { LANGUAGES } from '../constants/languages';

declare const __APP_VERSION__: string;

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
  const { success, showSuccess, clearSuccess } = useSuccessMessage();
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
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [paymentLink, setPaymentLink] = useState('');
  const [editingPaymentLink, setEditingPaymentLink] = useState(false);
  const [savingPaymentLink, setSavingPaymentLink] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [viewImageKey, setViewImageKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackFileInputRef = useRef<HTMLInputElement>(null);
  const qrFileInputRef = useRef<HTMLInputElement>(null);

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

  // --- Effects ---

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        setUser(data);
        setEditName(data.displayName);
        setPaymentLink(data.paymentLink ?? '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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

  // --- Handlers ---

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
      const name = editName.trim();
      await api.updateMe({ displayName: name });
      setUser((prev) => (prev ? { ...prev, displayName: name } : prev));
      setUserContext((prev) =>
        prev
          ? { ...prev, displayName: name }
          : { displayName: name, avatarKey: null, isAdmin: false },
      );
      setEditing(false);
      showSuccess(t('account.nameUpdated'));
    } catch (err: any) {
      setError(err.message || 'Failed to update name');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
      showSuccess(t('account.avatarUpdated'));
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleAvatarDelete() {
    if (!user?.avatarKey) return;
    if (!confirm(t('account.removePhotoConfirm'))) return;
    setError(null);
    try {
      await api.deleteAvatar();
      setUser((prev) => (prev ? { ...prev, avatarKey: null } : prev));
      setUserContext((prev) => (prev ? { ...prev, avatarKey: null } : prev));
      showSuccess(t('account.avatarRemoved'));
    } catch (err: any) {
      setError(err.message || 'Failed to remove avatar');
    }
  }

  async function handleSavePaymentLink() {
    if (savingPaymentLink) return;
    setSavingPaymentLink(true);
    setError(null);
    try {
      const link = paymentLink.trim() || null;
      await api.updateMe({ paymentLink: link });
      setUser((prev) => (prev ? { ...prev, paymentLink: link } : prev));
      setEditingPaymentLink(false);
      showSuccess(t(link ? 'account.paymentLinkSaved' : 'account.paymentLinkRemoved'));
    } catch (err: any) {
      setError(err.message || 'Failed to save payment link');
    } finally {
      setSavingPaymentLink(false);
    }
  }

  async function handleQrUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploadingQr(true);
    setError(null);
    try {
      const processed = await processPaymentQr(file);
      const result = await api.uploadPaymentQr(processed.blob);
      setUser((prev) => (prev ? { ...prev, paymentQrKey: result.paymentQrKey } : prev));
      showSuccess(t('account.paymentQrUpdated'));
    } catch (err: any) {
      setError(err.message || 'Failed to upload QR');
    } finally {
      setUploadingQr(false);
    }
  }

  async function handleQrDelete() {
    if (!user?.paymentQrKey) return;
    if (!confirm(t('account.removeQrConfirm'))) return;
    setError(null);
    try {
      await api.deletePaymentQr();
      setUser((prev) => (prev ? { ...prev, paymentQrKey: null } : prev));
      showSuccess(t('account.paymentQrRemoved'));
    } catch (err: any) {
      setError(err.message || 'Failed to remove QR');
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
      showSuccess(t('account.feedbackSent'));
    } catch (err: any) {
      setError(err.message || 'Failed to send feedback');
    } finally {
      setSendingFeedback(false);
    }
  }

  function handleFeedbackFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const snapshot = Array.from(files);
    e.target.value = '';
    setFeedbackFiles((prev) => [...prev, ...snapshot].slice(0, 5));
  }

  async function handleDeletePreflight() {
    setError(null);
    setActionLoading(-1);
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

  // --- Render ---

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
      {success && <SuccessBanner message={success} onDismiss={clearSuccess} />}
      {networkMismatch && (
        <ErrorBanner
          message={t('account.walletNetworkMismatch', {
            network: config.tonNetwork === 'mainnet' ? 'mainnet' : 'testnet',
          })}
          onDismiss={clearNetworkMismatch}
        />
      )}
      {walletConnected &&
        user?.walletAddress &&
        rawAddress &&
        rawAddress !== user.walletAddress && (
          <div className="mb-4 p-3 rounded-xl border border-app-warning/30 bg-app-warning-bg text-sm">
            <p className="text-app-warning font-medium">{t('account.walletMismatch')}</p>
            <p className="text-tg-hint text-xs mt-1">{t('account.walletMismatchHint')}</p>
          </div>
        )}

      <ProfileSection
        user={user}
        editName={editName}
        editing={editing}
        saving={saving}
        uploadingAvatar={uploadingAvatar}
        fileInputRef={fileInputRef}
        onEditNameChange={setEditName}
        onStartEditing={() => setEditing(true)}
        onCancelEditing={() => {
          setEditing(false);
          setEditName(user?.displayName ?? '');
        }}
        onSave={handleSave}
        onAvatarUpload={handleAvatarUpload}
        onAvatarDelete={handleAvatarDelete}
      />

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

      <WalletSection
        walletConnected={walletConnected}
        friendlyAddress={friendlyAddress}
        walletVersion={walletVersion}
        showBalances={showBalances}
        balancesLoading={balancesLoading}
        tonBalance={tonBalance}
        usdtBalance={usdtBalance}
        onToggleBalances={toggleBalances}
        onConnect={openModal}
        onDisconnect={disconnect}
      />

      <PaymentInfoSection
        user={user}
        paymentLink={paymentLink}
        editingPaymentLink={editingPaymentLink}
        savingPaymentLink={savingPaymentLink}
        uploadingQr={uploadingQr}
        qrFileInputRef={qrFileInputRef}
        onPaymentLinkChange={setPaymentLink}
        onStartEditingPaymentLink={() => setEditingPaymentLink(true)}
        onCancelEditingPaymentLink={() => {
          setEditingPaymentLink(false);
          setPaymentLink(user?.paymentLink ?? '');
        }}
        onSavePaymentLink={handleSavePaymentLink}
        onQrUpload={handleQrUpload}
        onQrDelete={handleQrDelete}
        onViewQr={setViewImageKey}
      />

      <LinksSection isAdmin={!!userCtx?.isAdmin} onOpenFeedback={() => setShowFeedback(true)} />

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

      {userCtx?.isAdmin && (
        <DebugPanel
          walletConnected={walletConnected}
          walletVersion={walletVersion}
          friendlyAddress={friendlyAddress}
        />
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

      <DeleteAccountSheet
        open={showDeleteFlow}
        onClose={() => setShowDeleteFlow(false)}
        deleteStep={deleteStep}
        preflightGroups={preflightGroups}
        resolvedGroupIds={resolvedGroupIds}
        selectedAdmins={selectedAdmins}
        actionLoading={actionLoading}
        deleting={deleting}
        onPreflight={handleDeletePreflight}
        onTransferAdmin={handleTransferAdmin}
        onDeleteGroup={handleDeleteGroupForDeletion}
        onSelectAdmin={(groupId, userId) =>
          setSelectedAdmins((prev) => ({ ...prev, [groupId]: userId }))
        }
        onContinueToConfirm={() => setDeleteStep('confirm')}
        onDeleteAccount={handleDeleteAccount}
      />

      <FeedbackSheet
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
        feedbackText={feedbackText}
        feedbackFiles={feedbackFiles}
        sendingFeedback={sendingFeedback}
        feedbackFileInputRef={feedbackFileInputRef}
        onTextChange={setFeedbackText}
        onFileSelect={handleFeedbackFileSelect}
        onRemoveFile={(i) => setFeedbackFiles((prev) => prev.filter((_, j) => j !== i))}
        onSend={handleSendFeedback}
      />

      {/* Image viewer (payment QR) */}
      <ImageViewer
        imageKey={viewImageKey}
        open={!!viewImageKey}
        onClose={() => setViewImageKey(null)}
      />
    </PageLayout>
  );
}
