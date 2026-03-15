import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type SettlementDetail } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { useSettlement } from '../hooks/useSettlement';
import { formatAmount } from '../utils/format';
import { getCurrency } from '../utils/currencies';
import {
  validateImageFile,
  processReceipt,
  processReceiptThumbnail,
  imageUrl,
} from '../utils/image';
import { sanitizeDecimalInput } from '../utils/input';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { ImageViewer } from '../components/ImageViewer';
import { IconTon, IconCheck, IconExternalLink } from '../icons';
import { openExternalLink } from '../utils/links';

export function SettleManual() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const settlementId = parseInt(id ?? '', 10);

  const { settlement, setSettlement, loading, error, setError, amountStr, setAmountStr } =
    useSettlement(settlementId);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [viewImageKey, setViewImageKey] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState(false);
  const [paidAmountStr, setPaidAmountStr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const backPath = settlement ? `/groups/${settlement.groupId}?tab=balances` : undefined;
  useTelegramBackButton(true, backPath);

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
      if (receiptFile) {
        const [processed, thumb] = await Promise.all([
          processReceipt(receiptFile),
          processReceiptThumbnail(receiptFile),
        ]);
        await api.uploadSettlementReceipt(settlementId, processed.blob, thumb.blob);
      }
      setSettlement((prev) => (prev ? { ...prev, status: 'settled_external' as const } : prev));
      setPaidAmountStr(formatAmount(microAmount, settlement!.currency));
      setManualSuccess(true);
      setTimeout(
        () => navigate(`/groups/${settlement!.groupId}?tab=balances`, { replace: true }),
        2000,
      );
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
      <div className="bg-tg-section px-4 py-3 rounded-xl border border-tg-separator mb-4 flex items-center justify-between">
        <span className="text-sm text-tg-hint">
          {isDebtor
            ? t('settleUp.youOwe', { name: settlement.to?.displayName })
            : isCreditor
              ? t('settleUp.owesYou', { name: settlement.from?.displayName })
              : t('settleUp.owes', {
                  from: settlement.from?.displayName,
                  to: settlement.to?.displayName,
                })}
        </span>
        <span className="text-lg font-bold">
          {formatAmount(settlement.amount, settlement.currency)}
        </span>
      </div>

      {/* Settled status */}
      {isSettled && (
        <div className="bg-app-positive-bg p-4 rounded-xl mb-6">
          <div className="flex items-center justify-center gap-2 mb-1">
            {settlement.status === 'settled_onchain' ? (
              <IconTon size={16} className="text-app-positive" />
            ) : (
              <IconCheck size={16} className="text-app-positive" />
            )}
            <span className="text-app-positive font-medium text-lg">{t('settleUp.settled')}</span>
          </div>

          {/* On-chain details */}
          {settlement.status === 'settled_onchain' && (
            <SettledOnchainDetails settlement={settlement} t={t} />
          )}

          {/* External settlement details */}
          {settlement.status === 'settled_external' && settlement.settledBy && (
            <div className="mt-2 text-sm text-app-positive/70 text-center">
              {t('settlement.settledByLabel', {
                name:
                  settlement.settledBy === settlement.from?.userId
                    ? settlement.from.displayName
                    : (settlement.to?.displayName ?? ''),
              })}
            </div>
          )}

          {settlement.comment && (
            <div className="text-sm text-app-positive/70 text-center mt-2 italic">
              &ldquo;{settlement.comment}&rdquo;
            </div>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Manual settlement success */}
      {manualSuccess && (
        <div className="bg-app-positive-bg p-8 rounded-2xl text-center mb-6">
          <div className="text-5xl mb-3">&#127881;</div>
          <div className="text-app-positive font-bold text-xl mb-1">{t('settleUp.settled')}</div>
          <div className="text-app-positive/70 text-sm">{paidAmountStr}</div>
        </div>
      )}

      {/* Manual settlement form */}
      {!isSettled && (isDebtor || isCreditor) && !manualSuccess && (
        <div className="space-y-4">
          {/* Amount input */}
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
                onChange={(e) => setAmountStr(sanitizeDecimalInput(e.target.value))}
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
            {!comment.trim() && !receiptFile && (
              <div className="text-xs text-tg-hint mt-1">{t('settleUp.noteOrReceiptRequired')}</div>
            )}
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
              aria-label={t('settleUp.attachReceipt')}
            />
          </div>

          {/* Recipient payment info — shown to debtor */}
          {isDebtor && (settlement.to?.paymentLink || settlement.to?.paymentQrKey) && (
            <div className="bg-tg-secondary-bg p-4 rounded-xl space-y-3">
              <div className="text-sm font-medium">
                {t('settlement.recipientPaymentInfo', {
                  name: settlement.to?.displayName ?? '',
                })}
              </div>
              {settlement.to?.paymentQrKey && (
                <button onClick={() => setViewImageKey(settlement.to!.paymentQrKey)}>
                  <img
                    src={imageUrl(settlement.to.paymentQrKey)}
                    alt="Payment QR"
                    className="w-40 h-40 rounded-lg object-cover border border-tg-separator mx-auto"
                  />
                </button>
              )}
              {settlement.to?.paymentLink && (
                <a
                  href={settlement.to.paymentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-tg-link text-sm font-medium"
                >
                  {t('settlement.openPaymentLink')}
                  <IconExternalLink size={14} />
                </a>
              )}
            </div>
          )}

          <button
            onClick={() => {
              const msg = isDebtor
                ? t('settleUp.confirmMarkPaid')
                : t('settleUp.confirmMarkReceived');
              if (window.confirm(msg)) handleMarkSettled();
            }}
            disabled={submitting || (!comment.trim() && !receiptFile)}
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
        <button onClick={() => setViewImageKey(settlement.receiptKey)} className="mt-4">
          <img
            src={imageUrl(settlement.receiptThumbKey)}
            alt="Receipt"
            className="w-20 h-20 rounded-xl object-cover border border-tg-separator mx-auto"
          />
        </button>
      )}

      {/* Image viewer (receipts, payment QR) */}
      <ImageViewer
        imageKey={viewImageKey}
        open={!!viewImageKey}
        onClose={() => setViewImageKey(null)}
      />
    </PageLayout>
  );
}

function SettledOnchainDetails({
  settlement,
  t,
}: {
  settlement: SettlementDetail;
  t: (key: string, opts?: Record<string, string>) => string;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-app-positive/20 space-y-2">
      {settlement.usdtAmount != null && (
        <div className="flex justify-between text-sm">
          <span className="text-app-positive/70">USDT</span>
          <span className="text-app-positive font-medium">
            {(settlement.usdtAmount / 1_000_000).toFixed(2)} USDT
          </span>
        </div>
      )}
      {settlement.commission != null && settlement.commission > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-app-positive/70">{t('settlement.commissionLabel')}</span>
          <span className="text-app-positive/70">
            {(settlement.commission / 1_000_000).toFixed(2)} USDT
          </span>
        </div>
      )}
      {settlement.txHash && (
        <div className="pt-1">
          {settlement.explorerUrl ? (
            <button
              onClick={(e) => openExternalLink(settlement.explorerUrl!, e)}
              className="inline-flex items-center gap-1.5 text-xs text-tg-link"
            >
              <IconTon size={12} />
              {t('settlement.viewTransaction')}
              <IconExternalLink size={12} />
            </button>
          ) : (
            <div className="text-xs text-tg-hint">TX: {settlement.txHash.slice(0, 16)}...</div>
          )}
        </div>
      )}
    </div>
  );
}
