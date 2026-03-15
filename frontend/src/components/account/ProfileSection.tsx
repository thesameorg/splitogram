import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../Avatar';
import type { UserProfile } from '../../services/api';

interface ProfileSectionProps {
  user: UserProfile | null;
  editName: string;
  editing: boolean;
  saving: boolean;
  uploadingAvatar: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onEditNameChange: (name: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarDelete: () => void;
}

export function ProfileSection({
  user,
  editName,
  editing,
  saving,
  uploadingAvatar,
  fileInputRef,
  onEditNameChange,
  onStartEditing,
  onCancelEditing,
  onSave,
  onAvatarUpload,
  onAvatarDelete,
}: ProfileSectionProps) {
  const { t } = useTranslation();

  return (
    <>
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
            <button onClick={onAvatarDelete} className="text-tg-destructive text-sm font-medium">
              {t('account.removePhoto')}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onAvatarUpload}
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
              onChange={(e) => onEditNameChange(e.target.value)}
              className="flex-1 p-3 border border-tg-separator rounded-xl bg-transparent"
              autoFocus
              maxLength={64}
            />
            <button
              onClick={onSave}
              disabled={saving || !editName.trim()}
              className="px-4 py-2 bg-tg-button text-tg-button-text rounded-xl font-medium disabled:opacity-50"
            >
              {saving ? '...' : t('account.save')}
            </button>
            <button
              onClick={onCancelEditing}
              className="px-4 py-2 border border-tg-separator rounded-xl"
            >
              {t('account.cancel')}
            </button>
          </div>
        ) : (
          <div className="flex justify-between items-center p-3 bg-tg-section rounded-xl border border-tg-separator">
            <span className="font-medium">{user?.displayName}</span>
            <button onClick={onStartEditing} className="text-tg-link text-sm font-medium">
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
    </>
  );
}
