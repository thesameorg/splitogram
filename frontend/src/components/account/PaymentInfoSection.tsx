import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { imageUrl } from '../../utils/image';
import type { UserProfile } from '../../services/api';

interface PaymentInfoSectionProps {
  user: UserProfile | null;
  paymentLink: string;
  editingPaymentLink: boolean;
  savingPaymentLink: boolean;
  uploadingQr: boolean;
  qrFileInputRef: RefObject<HTMLInputElement | null>;
  onPaymentLinkChange: (link: string) => void;
  onStartEditingPaymentLink: () => void;
  onCancelEditingPaymentLink: () => void;
  onSavePaymentLink: () => void;
  onQrUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onQrDelete: () => void;
  onViewQr: (key: string | null) => void;
}

export function PaymentInfoSection({
  user,
  paymentLink,
  editingPaymentLink,
  savingPaymentLink,
  uploadingQr,
  qrFileInputRef,
  onPaymentLinkChange,
  onStartEditingPaymentLink,
  onCancelEditingPaymentLink,
  onSavePaymentLink,
  onQrUpload,
  onQrDelete,
  onViewQr,
}: PaymentInfoSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1 text-tg-hint">
        {t('account.paymentInfo')}
      </label>
      <div className="card rounded-2xl p-3 space-y-3">
        {/* Payment Link */}
        <div>
          <div className="text-xs text-tg-hint mb-1">{t('account.paymentLink')}</div>
          {editingPaymentLink ? (
            <div className="flex gap-2">
              <input
                type="url"
                value={paymentLink}
                onChange={(e) => onPaymentLinkChange(e.target.value)}
                placeholder={t('account.paymentLinkPlaceholder')}
                className="flex-1 min-w-0 p-2 border border-ghost rounded-lg bg-app-card-nested text-sm"
                autoFocus
                maxLength={500}
              />
              <button
                onClick={onSavePaymentLink}
                disabled={savingPaymentLink}
                className="px-3 py-2 bg-tg-button text-tg-button-text rounded-lg text-sm font-medium shrink-0 disabled:opacity-50"
              >
                {savingPaymentLink ? '...' : t('account.save')}
              </button>
              <button
                onClick={onCancelEditingPaymentLink}
                className="px-3 py-2 border border-ghost rounded-lg text-sm shrink-0"
              >
                {t('account.cancel')}
              </button>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <span className="text-sm truncate flex-1">
                {user?.paymentLink || (
                  <span className="text-tg-hint">{t('account.paymentLinkPlaceholder')}</span>
                )}
              </span>
              <button
                onClick={onStartEditingPaymentLink}
                className="text-tg-link text-sm font-medium ml-2 shrink-0"
              >
                {t('account.edit')}
              </button>
            </div>
          )}
        </div>

        {/* Payment QR */}
        <div className="pt-2 border-t border-ghost">
          <div className="text-xs text-tg-hint mb-2">{t('account.paymentQr')}</div>
          {user?.paymentQrKey ? (
            <div className="flex items-start gap-3">
              <button onClick={() => onViewQr(user.paymentQrKey)}>
                <img
                  src={imageUrl(user.paymentQrKey!)}
                  alt="Payment QR"
                  className="w-24 h-24 rounded-lg object-cover border border-ghost"
                />
              </button>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => qrFileInputRef.current?.click()}
                  disabled={uploadingQr}
                  className="text-tg-link text-sm font-medium disabled:opacity-50"
                >
                  {t('account.changePaymentQr')}
                </button>
                <button onClick={onQrDelete} className="text-tg-destructive text-sm font-medium">
                  {t('account.removePaymentQr')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => qrFileInputRef.current?.click()}
              disabled={uploadingQr}
              className="w-full p-3 border border-dashed border-ghost rounded-lg text-sm text-tg-hint disabled:opacity-50"
            >
              {uploadingQr ? '...' : t('account.addPaymentQr')}
            </button>
          )}
          <input
            ref={qrFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onQrUpload}
            className="hidden"
            aria-label={t('account.paymentQr')}
          />
        </div>
      </div>
    </div>
  );
}
