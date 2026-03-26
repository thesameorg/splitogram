import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../BottomSheet';

interface PreflightGroup {
  id: number;
  name: string;
  candidates: Array<{ userId: number; displayName: string }>;
}

interface DeleteAccountSheetProps {
  open: boolean;
  onClose: () => void;
  deleteStep: 'warning' | 'groups' | 'confirm';
  preflightGroups: PreflightGroup[];
  resolvedGroupIds: Set<number>;
  selectedAdmins: Record<number, number>;
  actionLoading: number | null;
  deleting: boolean;
  onPreflight: () => void;
  onTransferAdmin: (groupId: number) => void;
  onDeleteGroup: (groupId: number) => void;
  onSelectAdmin: (groupId: number, userId: number) => void;
  onContinueToConfirm: () => void;
  onDeleteAccount: () => void;
}

export function DeleteAccountSheet({
  open,
  onClose,
  deleteStep,
  preflightGroups,
  resolvedGroupIds,
  selectedAdmins,
  actionLoading,
  deleting,
  onPreflight,
  onTransferAdmin,
  onDeleteGroup,
  onSelectAdmin,
  onContinueToConfirm,
  onDeleteAccount,
}: DeleteAccountSheetProps) {
  const { t } = useTranslation();

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        if (!deleting) onClose();
      }}
      title={t('account.deleteAccount')}
    >
      <div className="space-y-4">
        {deleteStep === 'warning' && (
          <>
            <p className="text-sm text-tg-hint">{t('account.deleteWarning')}</p>
            <button
              onClick={onPreflight}
              disabled={actionLoading === -1}
              className="w-full py-3 rounded-xl bg-tg-destructive text-white font-medium disabled:opacity-50"
            >
              {actionLoading === -1 ? '...' : t('account.deleteContinue')}
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl border border-ghost font-medium"
            >
              {t('account.cancel')}
            </button>
          </>
        )}

        {deleteStep === 'groups' && (
          <>
            <p className="text-sm text-tg-hint font-medium">{t('account.deleteGroupsSubtitle')}</p>

            <div className="space-y-3">
              {preflightGroups.map((group) => {
                const resolved = resolvedGroupIds.has(group.id);
                const isLoading = actionLoading === group.id;

                return (
                  <div
                    key={group.id}
                    className={`p-3 rounded-xl ${resolved ? 'border border-app-positive/30 bg-app-positive-bg' : 'bg-app-card-nested'}`}
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
                                onSelectAdmin(group.id, parseInt(e.target.value, 10))
                              }
                              className="flex-1 p-2 text-sm rounded-lg border border-ghost bg-app-card-nested"
                            >
                              <option value="">{t('account.selectNewAdmin')}</option>
                              {group.candidates.map((c) => (
                                <option key={c.userId} value={c.userId}>
                                  {c.displayName}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => onTransferAdmin(group.id)}
                              disabled={!selectedAdmins[group.id] || isLoading}
                              className="px-3 py-2 text-sm rounded-lg bg-tg-button text-tg-button-text font-medium disabled:opacity-50"
                            >
                              {isLoading ? '...' : t('account.transferAdmin')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => onDeleteGroup(group.id)}
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
              onClick={onContinueToConfirm}
              disabled={resolvedGroupIds.size < preflightGroups.length}
              className="w-full py-3 rounded-xl bg-tg-destructive text-white font-medium disabled:opacity-50"
            >
              {t('account.deleteContinue')}
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl border border-ghost font-medium"
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
              onClick={onDeleteAccount}
              disabled={deleting}
              className="w-full py-3 rounded-xl bg-tg-destructive text-white font-medium disabled:opacity-50"
            >
              {deleting ? '...' : t('account.deleteConfirmFinal')}
            </button>
            {!deleting && (
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl border border-ghost font-medium"
              >
                {t('account.cancel')}
              </button>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
