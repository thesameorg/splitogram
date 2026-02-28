import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
      setError(err.message || 'Failed to save settings');
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
    shareInviteLink(group.inviteCode, group.name);
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

  if (loading || !group) return <LoadingScreen />;

  const creator = group.members.find((m) => m.role === 'admin');

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">
        {isAdmin ? t('groupSettings.title') : t('groupSettings.infoTitle')}
      </h1>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess(null)} />}

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
          {group.members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center justify-between bg-tg-section p-3 rounded-xl border border-tg-separator"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{m.displayName}</span>
                {/* A7: Crown only, no "Admin" text */}
                {m.role === 'admin' && <span className="text-xs text-app-warning">&#9812;</span>}
                {m.userId === currentUserId && (
                  <span className="text-xs text-tg-hint">{t('groupSettings.you')}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {m.username && <span className="text-sm text-tg-hint">@{m.username}</span>}
                {/* A8: Kick button — admin can kick non-admin, non-self members */}
                {isAdmin && m.role !== 'admin' && m.userId !== currentUserId && (
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
        </div>
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
    </PageLayout>
  );
}
