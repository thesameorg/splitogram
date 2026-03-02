import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type SettlementDetail } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { formatAmount } from '../utils/format';
import { getCurrency } from '../utils/currencies';
import {
  validateImageFile,
  processReceipt,
  processReceiptThumbnail,
  imageUrl,
} from '../utils/image';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { BottomSheet } from '../components/BottomSheet';
import { ReportImage } from '../components/ReportImage';

export function SettleUp() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const settlementId = parseInt(id ?? '', 10);

  const [settlement, setSettlement] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptViewKey, setReceiptViewKey] = useState<string | null>(null);
  const [reportImageKey, setReportImageKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useTelegramBackButton(true);

  useEffect(() => {
    if (isNaN(settlementId)) return;
    api
      .getSettlement(settlementId)
      .then((data) => {
        setSettlement(data);
        const currency = getCurrency(data.currency);
        const display = data.amount / 1_000_000;
        setAmountStr(
          currency.decimals === 0
            ? String(Math.round(display))
            : display.toFixed(currency.decimals),
        );
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [settlementId]);

  const isDebtor = settlement?.currentUserId === settlement?.fromUser;
  const isCreditor = settlement?.currentUserId === settlement?.toUser;
  const isSettled =
    settlement?.status === 'settled_onchain' || settlement?.status === 'settled_external';

  function handleReceiptSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
  }

  function handleRemoveReceipt() {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptFile(null);
    setReceiptPreview(null);
  }

  async function handleMarkSettled() {
    setError(null);
    setSubmitting(true);
    try {
      const parsedAmount = parseFloat(amountStr);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setError(t('settleUp.invalidAmount'));
        setSubmitting(false);
        return;
      }
      const microAmount = Math.round(parsedAmount * 1_000_000);
      const customAmount = microAmount !== settlement!.amount ? microAmount : undefined;
      await api.markExternal(settlementId, comment.trim() || undefined, customAmount);
      // Upload receipt if attached
      if (receiptFile) {
        const [processed, thumb] = await Promise.all([
          processReceipt(receiptFile),
          processReceiptThumbnail(receiptFile),
        ]);
        await api.uploadSettlementReceipt(settlementId, processed.blob, thumb.blob);
      }
      setSettlement((prev) => (prev ? { ...prev, status: 'settled_external' as const } : prev));
      setTimeout(() => navigate(-1), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to mark as settled');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingScreen />;

  if (!settlement) {
    return (
      <PageLayout>
        <div className="text-center py-12">
          <p className="text-tg-destructive">{error || t('settleUp.notFound')}</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">{t('settleUp.title')}</h1>

      {/* Settlement info */}
      <div className="bg-tg-section p-6 rounded-2xl border border-tg-separator mb-6 text-center">
        <div className="text-sm text-tg-hint mb-2">
          {isDebtor
            ? t('settleUp.youOwe', { name: settlement.to?.displayName })
            : isCreditor
              ? t('settleUp.owesYou', { name: settlement.from?.displayName })
              : t('settleUp.owes', {
                  from: settlement.from?.displayName,
                  to: settlement.to?.displayName,
                })}
        </div>
        <div className="text-3xl font-bold mb-1">
          {formatAmount(settlement.amount, settlement.currency)}
        </div>
      </div>

      {/* Status */}
      {isSettled && (
        <div className="bg-app-positive-bg p-4 rounded-xl mb-6 text-center">
          <div className="text-app-positive font-medium text-lg">{t('settleUp.settled')}</div>
          {settlement.comment && (
            <div className="text-sm text-tg-hint mt-1">{settlement.comment}</div>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Actions */}
      {!isSettled && (isDebtor || isCreditor) && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-tg-hint">
              {t('settleUp.amount')}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-tg-hint">
                {getCurrency(settlement.currency).symbol}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full p-3 pl-8 border border-tg-separator rounded-xl bg-transparent"
              />
            </div>
            <div className="text-xs text-tg-hint mt-1">
              {t('settleUp.debtAmount')}: {formatAmount(settlement.amount, settlement.currency)}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-tg-hint">
              {t('settleUp.note')}
            </label>
            <input
              type="text"
              placeholder={t('settleUp.notePlaceholder')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full p-3 border border-tg-separator rounded-xl bg-transparent"
              maxLength={500}
            />
          </div>

          {/* Receipt attachment */}
          <div>
            {receiptPreview ? (
              <div className="flex items-center gap-3 p-3 bg-tg-section rounded-xl border border-tg-separator">
                <img
                  src={receiptPreview}
                  alt="Receipt"
                  className="w-12 h-12 rounded-lg object-cover"
                />
                <span className="flex-1 text-sm font-medium">
                  {t('addExpense.receiptAttached')}
                </span>
                <button
                  onClick={handleRemoveReceipt}
                  className="text-tg-destructive text-sm font-medium"
                >
                  {t('addExpense.removeReceipt')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-3 border border-dashed border-tg-separator rounded-xl text-sm text-tg-hint"
              >
                {t('settleUp.attachReceipt')}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleReceiptSelect}
              className="hidden"
            />
          </div>

          <button
            onClick={handleMarkSettled}
            disabled={submitting}
            className="w-full bg-tg-button text-tg-button-text py-4 rounded-xl font-medium disabled:opacity-50"
          >
            {submitting
              ? t('settleUp.settling')
              : isDebtor
                ? t('settleUp.markAsPaid')
                : t('settleUp.markAsReceived')}
          </button>
        </div>
      )}

      {/* Settled receipt thumbnail */}
      {isSettled && settlement.receiptThumbKey && (
        <button onClick={() => setReceiptViewKey(settlement.receiptKey)} className="mt-4">
          <img
            src={imageUrl(settlement.receiptThumbKey)}
            alt="Receipt"
            className="w-20 h-20 rounded-xl object-cover border border-tg-separator mx-auto"
          />
        </button>
      )}

      {/* Receipt viewer */}
      <BottomSheet open={!!receiptViewKey} onClose={() => setReceiptViewKey(null)} title="">
        {receiptViewKey && (
          <div>
            <img
              src={imageUrl(receiptViewKey)}
              alt="Receipt"
              className="w-full rounded-xl"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <button
              onClick={() => {
                setReportImageKey(receiptViewKey);
                setReceiptViewKey(null);
              }}
              className="mt-3 text-xs text-tg-hint"
            >
              ⚠️ {t('report.button')}
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Report image */}
      <ReportImage
        imageKey={reportImageKey}
        open={!!reportImageKey}
        onClose={() => setReportImageKey(null)}
      />
    </PageLayout>
  );
}
