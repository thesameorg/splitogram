import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type GroupDetail } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { resolveCurrentUser } from '../hooks/useCurrentUser';
import { shareInviteLink, sharePersonalizedInviteLink } from '../utils/share';
import { validateImageFile, processAvatar } from '../utils/image';
import { CurrencyPicker, CurrencyButton } from '../components/CurrencyPicker';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessBanner } from '../components/SuccessBanner';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { IconCrown, IconCopy } from '../icons';

const GROUP_EMOJIS = [
  '\u{1F3E0}',
  '\u{2708}\u{FE0F}',
  '\u{1F37D}\u{FE0F}',
  '\u{1F3D5}\u{FE0F}',
  '\u{1F3EB}',
  '\u{1F3E2}',
  '\u{1F3C0}',
  '\u{1F3B5}',
  '\u{1F697}',
  '\u{1F3AE}',
  '\u{1F4BC}',
  '\u{1F4DA}',
  '\u{1F389}',
  '\u{2615}',
  '\u{1F3D6}\u{FE0F}',
  '\u{1F3B2}',
  '\u{1F4B0}',
  '\u{1F6D2}',
  '\u{1F3CB}\u{FE0F}',
  '\u{2764}\u{FE0F}',
  '\u{1F355}',
  '\u{1F3A4}',
  '\u{1F3B6}',
  '\u{26BD}',
  '\u{1F3BE}',
  '\u{1F3B3}',
  '\u{1F6B2}',
  '\u{1F3A2}',
  '\u{1F30E}',
  '\u{1F3D4}\u{FE0F}',
  '\u{26F5}',
  '\u{1F680}',
  '\u{1F381}',
  '\u{1F3E5}',
  '\u{1F393}',
  '\u{1F4BB}',
  '\u{1F37B}',
  '\u{1F354}',
  '\u{1F370}',
  '\u{1F3A8}',
  '\u{1F436}',
  '\u{1F431}',
  '\u{1F308}',
  '\u{2B50}',
  '\u{1F525}',
  '\u{1F3C6}',
  '\u{1F48E}',
  '\u{1F4A1}',
];

export function GroupSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showAddPlaceholder, setShowAddPlaceholder] = useState(false);
  const [placeholderName, setPlaceholderName] = useState('');
  const [addingPlaceholder, setAddingPlaceholder] = useState(false);
  const [editingPlaceholder, setEditingPlaceholder] = useState<{
    userId: number;
    name: string;
  } | null>(null);
  const [editPlaceholderName, setEditPlaceholderName] = useState('');
  const [showAllMembers, setShowAllMembers] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setSuccess(t('groupSettings.settingsSaved'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      if (err instanceof ApiError && err.errorCode === 'currency_locked') {
        setError(t('groupSettings.currencyLocked'));
        // Refresh group data to get hasTransactions
        setGroup((prev) => (prev ? { ...prev, hasTransactions: true } : prev));
        setCurrency(group!.currency);
      } else {
        setError(err.message || 'Failed to save settings');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateInvite() {
    if (!confirm(t('groupSettings.regenerateConfirm'))) return;
    setError(null);
    try {
      const result = await api.regenerateInvite(groupId);
      setGroup((prev) => (prev ? { ...prev, inviteCode: result.inviteCode } : prev));
      setSuccess(t('groupSettings.inviteRegenerated'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate invite');
    }
  }

  function handleShareInvite() {
    if (!group) return;
    shareInviteLink(group.inviteCode, group.name, group.members.length);
  }

  async function handleCopyInvite() {
    if (!group) return;
    const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
    const link = `https://t.me/${botUsername}?start=join_${group.inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setSuccess(t('groupSettings.linkCopied'));
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      setError('Failed to copy link');
    }
  }

  async function handleSelectEmoji(emoji: string) {
    setShowEmojiPicker(false);
    setError(null);
    try {
      await api.updateGroup(groupId, { avatarEmoji: emoji });
      setGroup((prev) => (prev ? { ...prev, avatarEmoji: emoji, avatarKey: null } : prev));
    } catch (err: any) {
      setError(err.message || 'Failed to set emoji');
    }
  }

  async function handleGroupAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
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
      const result = await api.uploadGroupAvatar(groupId, processed.blob);
      setGroup((prev) =>
        prev ? { ...prev, avatarKey: result.avatarKey, avatarEmoji: null } : prev,
      );
      setSuccess(t('groupSettings.groupPhotoUpdated'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to upload group photo');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleRemoveGroupAvatar() {
    if (!confirm(t('groupSettings.removePhotoConfirm'))) return;
    setError(null);
    try {
      if (group?.avatarKey) {
        await api.deleteGroupAvatar(groupId);
      }
      if (group?.avatarEmoji) {
        await api.updateGroup(groupId, { avatarEmoji: null });
      }
      setGroup((prev) => (prev ? { ...prev, avatarKey: null, avatarEmoji: null } : prev));
      setSuccess(t('groupSettings.groupPhotoRemoved'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to remove group photo');
    }
  }

  async function handleDeleteGroup() {
    if (!confirm(t('groupSettings.deleteConfirm', { name: group?.name }))) return;
    setError(null);
    try {
      await api.deleteGroup(groupId);
      navigate('/', { replace: true });
    } catch (err: any) {
      if (err instanceof ApiError && err.errorCode === 'outstanding_balances') {
        if (confirm(t('groupSettings.deleteForceConfirm'))) {
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
    if (!confirm(t('groupSettings.leaveConfirm', { name: group?.name }))) return;
    setError(null);
    try {
      await api.leaveGroup(groupId);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to leave group');
    }
  }

  async function handleKickMember(userId: number, displayName: string) {
    if (!confirm(t('groupSettings.kickConfirm', { name: displayName }))) return;
    setError(null);
    try {
      await api.kickMember(groupId, userId);
      setGroup((prev) =>
        prev ? { ...prev, members: prev.members.filter((m) => m.userId !== userId) } : prev,
      );
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    }
  }

  async function handleAddPlaceholder() {
    if (!placeholderName.trim() || addingPlaceholder) return;
    setAddingPlaceholder(true);
    setError(null);
    try {
      const result = await api.createPlaceholder(groupId, placeholderName.trim());
      setGroup((prev) =>
        prev
          ? {
              ...prev,
              members: [
                ...prev.members,
                {
                  userId: result.userId,
                  telegramId: 0,
                  username: null,
                  displayName: result.displayName,
                  walletAddress: null,
                  avatarKey: null,
                  isDummy: true,
                  role: 'member',
                  muted: false,
                  joinedAt: new Date().toISOString(),
                },
              ],
            }
          : prev,
      );
      setPlaceholderName('');
      setShowAddPlaceholder(false);
      setSuccess(t('groupSettings.placeholderAdded'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to add placeholder');
    } finally {
      setAddingPlaceholder(false);
    }
  }

  async function handleEditPlaceholder() {
    if (!editingPlaceholder || !editPlaceholderName.trim()) return;
    setError(null);
    try {
      await api.editPlaceholder(groupId, editingPlaceholder.userId, editPlaceholderName.trim());
      setGroup((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.map((m) =>
                m.userId === editingPlaceholder.userId
                  ? { ...m, displayName: editPlaceholderName.trim() }
                  : m,
              ),
            }
          : prev,
      );
      setEditingPlaceholder(null);
      setSuccess(t('groupSettings.placeholderEdited'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to rename placeholder');
    }
  }

  async function handleDeletePlaceholder(userId: number, displayName: string) {
    if (!confirm(t('groupSettings.placeholderDeleteConfirm', { name: displayName }))) return;
    setError(null);
    try {
      await api.deletePlaceholder(groupId, userId);
      setGroup((prev) =>
        prev ? { ...prev, members: prev.members.filter((m) => m.userId !== userId) } : prev,
      );
      setSuccess(t('groupSettings.placeholderDeleted'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to remove placeholder');
    }
  }

  if (loading || !group) return <LoadingScreen />;

  const creator = group.members.find((m) => m.role === 'admin');

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">
        {isAdmin ? t('groupSettings.title') : t('groupSettings.infoTitle')}
      </h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess(null)} />}

      {/* Group avatar */}
      <div className="flex flex-col items-center mb-6">
        <div className="relative">
          <Avatar
            avatarKey={group.avatarKey}
            emoji={group.avatarEmoji}
            displayName={group.name}
            size="lg"
          />
          {uploadingAvatar && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-3 mt-3">
            <button
              onClick={() => setShowEmojiPicker(true)}
              className="text-tg-link text-sm font-medium"
            >
              {t('groupSettings.emojiPicker')}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="text-tg-link text-sm font-medium disabled:opacity-50"
            >
              {group.avatarKey
                ? t('groupSettings.changeGroupPhoto')
                : t('groupSettings.groupPhoto')}
            </button>
            {(group.avatarKey || group.avatarEmoji) && (
              <button
                onClick={handleRemoveGroupAvatar}
                className="text-tg-destructive text-sm font-medium"
              >
                {t('groupSettings.removeGroupPhoto')}
              </button>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleGroupAvatarUpload}
          className="hidden"
          aria-label="Upload group photo"
        />
      </div>

      {/* Group name */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('groupSettings.groupName')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full p-3 border border-tg-separator rounded-xl bg-transparent"
          disabled={!isAdmin}
          maxLength={100}
        />
      </div>

      {/* Currency */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('groupSettings.currency')}
        </label>
        <CurrencyButton
          value={currency}
          onClick={() => setShowCurrencyPicker(true)}
          disabled={!isAdmin || !!group.hasTransactions}
        />
        {group.hasTransactions && isAdmin && (
          <p className="text-xs text-tg-hint mt-1">{t('groupSettings.currencyLocked')}</p>
        )}
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
          className="w-full mb-6 bg-tg-button text-tg-button-text py-3 rounded-xl font-medium disabled:opacity-50"
        >
          {saving ? t('groupSettings.saving') : t('groupSettings.save')}
        </button>
      )}

      {/* Invite link */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-1 text-tg-hint">
          {t('groupSettings.inviteLink')}
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleShareInvite}
            className="flex-1 p-3 border border-tg-link text-tg-link rounded-xl text-sm font-medium"
          >
            {t('groupSettings.shareInvite')}
          </button>
          <button
            onClick={handleCopyInvite}
            className="p-3 border border-tg-link text-tg-link rounded-xl"
            title={t('groupSettings.copyInvite')}
          >
            <IconCopy size={18} />
          </button>
          {isAdmin && (
            <button
              onClick={handleRegenerateInvite}
              className="p-3 border border-tg-separator rounded-xl text-sm text-tg-hint"
            >
              {t('groupSettings.regenerate')}
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
          className="w-full flex justify-between items-center p-3 border border-tg-separator rounded-xl"
        >
          <span className="text-sm font-medium">{t('groupSettings.notifications')}</span>
          <span className={`text-sm ${muted ? 'text-app-negative' : 'text-app-positive'}`}>
            {muted ? t('groupSettings.muted') : t('groupSettings.on')}
          </span>
        </button>
      </div>

      {/* Members */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2 text-tg-hint">
          {t('groupSettings.members', { count: group.members.length })}
        </label>
        <div className="space-y-2">
          {[...group.members]
            .sort((a, b) => {
              if (a.userId === currentUserId) return -1;
              if (b.userId === currentUserId) return 1;
              return 0;
            })
            .slice(0, showAllMembers ? undefined : 5)
            .map((m) => (
              <div
                key={m.userId}
                className="flex items-center justify-between bg-tg-section p-3 rounded-xl border border-tg-separator"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Avatar avatarKey={m.avatarKey} displayName={m.displayName} size="sm" />
                  <span className="font-medium truncate">{m.displayName}</span>
                  {m.role === 'admin' && <IconCrown size={14} className="text-app-warning shrink-0" />}
                  {m.userId === currentUserId && (
                    <span className="text-xs text-tg-hint shrink-0">{t('groupSettings.you')}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {m.isDummy ? (
                    <span className="text-sm" title={t('groupSettings.placeholderBadge')}>&#128123;</span>
                  ) : m.username ? (
                    <span className="text-sm text-tg-hint">@{m.username}</span>
                  ) : null}
                  {isAdmin && m.isDummy && (
                    <>
                      <button
                        onClick={() => {
                          setEditingPlaceholder({ userId: m.userId, name: m.displayName });
                          setEditPlaceholderName(m.displayName);
                        }}
                        className="text-tg-link text-xs"
                      >
                        {t('groupSettings.editPlaceholder')}
                      </button>
                      <button
                        onClick={() =>
                          sharePersonalizedInviteLink(
                            group.inviteCode,
                            m.userId,
                            group.name,
                            m.displayName,
                          )
                        }
                        className="text-tg-link text-xs"
                      >
                        {t('groupSettings.sharePlaceholderInvite')}
                      </button>
                      <button
                        onClick={() => handleDeletePlaceholder(m.userId, m.displayName)}
                        className="text-tg-destructive text-sm"
                        title={t('groupSettings.kick')}
                      >
                        &#10005;
                      </button>
                    </>
                  )}
                  {isAdmin && !m.isDummy && m.role !== 'admin' && m.userId !== currentUserId && (
                    <button
                      onClick={() => handleKickMember(m.userId, m.displayName)}
                      className="text-tg-destructive text-sm ml-2"
                      title={t('groupSettings.kick')}
                    >
                      &#10005;
                    </button>
                  )}
                </div>
              </div>
            ))}
          {group.members.length > 5 && (
            <button
              onClick={() => setShowAllMembers(!showAllMembers)}
              className="w-full py-2 text-sm text-tg-link font-medium"
            >
              {showAllMembers
                ? t('groupSettings.showLess')
                : t('groupSettings.showMore', { count: group.members.length - 5 })}
            </button>
          )}
        </div>

        {/* Add Placeholder button (admin only) */}
        {isAdmin && (
          <button
            onClick={() => setShowAddPlaceholder(true)}
            className="mt-3 w-full p-3 border border-dashed border-tg-separator rounded-xl text-sm text-tg-hint font-medium"
          >
            {t('groupSettings.addPlaceholder')}
          </button>
        )}
      </div>

      {/* Created by */}
      {creator && (
        <div className="text-sm text-tg-hint mb-6">
          {t('groupSettings.createdBy', { name: creator.displayName })}
        </div>
      )}

      {/* Danger zone */}
      <div className="border-t border-tg-separator pt-6">
        {isAdmin ? (
          <button
            onClick={handleDeleteGroup}
            className="w-full p-3 border border-tg-destructive text-tg-destructive rounded-xl font-medium"
          >
            {t('groupSettings.deleteGroup')}
          </button>
        ) : (
          <button
            onClick={handleLeaveGroup}
            className="w-full p-3 border border-tg-destructive text-tg-destructive rounded-xl font-medium"
          >
            {t('groupSettings.leaveGroup')}
          </button>
        )}
      </div>

      {/* Emoji Picker */}
      <BottomSheet
        open={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        title={t('groupSettings.emojiPicker')}
      >
        <div className="mb-3">
          <input
            type="text"
            placeholder={t('groupSettings.emojiInputPlaceholder')}
            className="w-full p-3 border border-tg-separator rounded-xl bg-transparent text-center text-2xl"
            maxLength={4}
            onInput={(e) => {
              const input = e.currentTarget;
              // Extract first emoji from input
              const match = input.value.match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u);
              if (match) {
                handleSelectEmoji(match[0]);
                input.value = '';
              }
            }}
          />
        </div>
        <div className="grid grid-cols-8 gap-1">
          {GROUP_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleSelectEmoji(emoji)}
              className={`text-2xl p-2 rounded-xl ${
                group.avatarEmoji === emoji ? 'bg-tg-button/10 ring-2 ring-tg-button' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Add Placeholder */}
      <BottomSheet
        open={showAddPlaceholder}
        onClose={() => {
          setShowAddPlaceholder(false);
          setPlaceholderName('');
        }}
        title={t('groupSettings.addPlaceholder')}
      >
        <div className="space-y-4">
          <input
            type="text"
            value={placeholderName}
            onChange={(e) => setPlaceholderName(e.target.value)}
            placeholder={t('groupSettings.placeholderNamePlaceholder')}
            className="w-full p-3 border border-tg-separator rounded-xl bg-transparent"
            autoFocus
            maxLength={64}
          />
          <button
            onClick={handleAddPlaceholder}
            disabled={addingPlaceholder || !placeholderName.trim()}
            className="w-full bg-tg-button text-tg-button-text py-3 rounded-xl font-medium disabled:opacity-50"
          >
            {addingPlaceholder
              ? t('groupSettings.placeholderAdding')
              : t('groupSettings.placeholderAdd')}
          </button>
        </div>
      </BottomSheet>

      {/* Edit Placeholder Name */}
      <BottomSheet
        open={!!editingPlaceholder}
        onClose={() => setEditingPlaceholder(null)}
        title={t('groupSettings.editPlaceholderTitle')}
      >
        <div className="space-y-4">
          <input
            type="text"
            value={editPlaceholderName}
            onChange={(e) => setEditPlaceholderName(e.target.value)}
            className="w-full p-3 border border-tg-separator rounded-xl bg-transparent"
            autoFocus
            maxLength={64}
          />
          <button
            onClick={handleEditPlaceholder}
            disabled={!editPlaceholderName.trim()}
            className="w-full bg-tg-button text-tg-button-text py-3 rounded-xl font-medium disabled:opacity-50"
          >
            {t('account.save')}
          </button>
        </div>
      </BottomSheet>
    </PageLayout>
  );
}
