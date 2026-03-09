import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type SettlementDetail, type SettlementTxParams } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { useTonWallet } from '../hooks/useTonWallet';
import { formatAmount } from '../utils/format';
import { getCurrency } from '../utils/currencies';
import { buildSettlementBody, truncateAddress, toFriendly } from '../utils/ton';
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
import { IconTon } from '../icons';

type CryptoState = 'idle' | 'preflight' | 'confirm' | 'sending' | 'polling' | 'success' | 'error';

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

  // Crypto settlement state
  const [cryptoState, setCryptoState] = useState<CryptoState>('idle');
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [txParams, setTxParams] = useState<SettlementTxParams | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    connected: walletConnected,
    rawAddress,
    friendlyAddress,
    tonConnectUI,
    openModal,
  } = useTonWallet();

  useTelegramBackButton(true);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

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
  const isPending = settlement?.status === 'payment_pending';

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
      setTimeout(() => navigate(-1), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to mark as settled');
    } finally {
      setSubmitting(false);
    }
  }

  // --- Crypto settlement flow ---

  async function handlePayWithUsdt() {
    setCryptoError(null);

    if (!walletConnected || !rawAddress) {
      openModal();
      return;
    }

    setCryptoState('preflight');
    try {
      const params = await api.getSettlementTx(settlementId, rawAddress);
      setTxParams(params);
      setCryptoState('confirm');
    } catch (err: any) {
      const code = err.errorCode;
      if (code === 'no_wallet') {
        setCryptoError(
          t('settlement.creditorNoWallet', { name: settlement?.to?.displayName ?? '' }),
        );
      } else if (code === 'no_usdt_wallet') {
        setCryptoError(
          t('settlement.insufficientUsdt', {
            balance: '0',
            required: formatUsdtAmount(settlement!.amount),
          }),
        );
      } else {
        setCryptoError(err.message || 'Failed to prepare transaction');
      }
      setCryptoState('error');
    }
  }

  async function handleConfirmPayment() {
    if (!txParams) return;

    setCryptoState('sending');
    setCryptoError(null);

    try {
      const payload = buildSettlementBody(txParams);

      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: txParams.network as any,
        messages: [
          {
            address: toFriendly(txParams.senderJettonWallet),
            amount: txParams.gasAttach,
            payload,
          },
        ],
      });

      // Transaction sent — notify backend and start polling
      try {
        await api.verifySettlement(settlementId, result.boc);
      } catch {
        // Backend may fail to receive, but tx is already on-chain
      }

      setSettlement((prev) => (prev ? { ...prev, status: 'payment_pending' } : prev));
      startPolling();
    } catch (err: any) {
      // TON Connect throws when user rejects or timeout
      const message = err?.message ?? String(err);
      console.error('sendTransaction error:', message, err);
      if (message.includes('reject') || message.includes('cancel') || message.includes('denied')) {
        setCryptoError(t('settlement.declined'));
      } else if (message.includes('timeout')) {
        setCryptoError(t('settlement.walletTimeout'));
      } else {
        setCryptoError(message || t('settlement.declined'));
      }
      setCryptoState('error');
    }
  }

  const startPolling = useCallback(() => {
    setCryptoState('polling');
    let elapsed = 0;
    const POLL_INTERVAL = 3000;
    const MAX_POLL = 90000; // 90 seconds

    pollingRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      try {
        const data = await api.getSettlement(settlementId);
        setSettlement(data);

        if (data.status === 'settled_onchain') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setCryptoState('success');
          setTimeout(() => navigate(-1), 2000);
        } else if (data.status === 'open') {
          // Rolled back
          if (pollingRef.current) clearInterval(pollingRef.current);
          setCryptoError(t('settlement.txFailed'));
          setCryptoState('error');
        } else if (elapsed >= MAX_POLL) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setCryptoError(t('settlement.txPending'));
          setCryptoState('error');
        }
      } catch {
        // Network error during poll — keep trying
        if (elapsed >= MAX_POLL) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setCryptoError(t('settlement.txPending'));
          setCryptoState('error');
        }
      }
    }, POLL_INTERVAL);
  }, [settlementId, navigate, t]);

  // If page loads with payment_pending, start polling
  useEffect(() => {
    if (isPending && cryptoState === 'idle') {
      startPolling();
    }
  }, [isPending, cryptoState, startPolling]);

  function handleRetry() {
    setCryptoState('idle');
    setCryptoError(null);
    setTxParams(null);
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

  const usdtAmount = txParams
    ? formatUsdtAmount(txParams.amount)
    : formatUsdtAmount(settlement.amount); // debt amount in USDT
  const commission = txParams
    ? formatUsdtAmount(txParams.commission)
    : formatUsdtCommission(settlement.amount);
  const totalPayment = txParams
    ? formatUsdtAmount(txParams.totalAmount)
    : formatUsdtAmount(settlement.amount + calculateCommission(settlement.amount));

  // Show conversion note if group currency differs from USD
  const conversionNote =
    txParams && txParams.originalCurrency !== 'USD'
      ? `${formatAmount(txParams.originalAmount, txParams.originalCurrency)} ≈ ${formatUsdtAmount(txParams.amount)} USDT`
      : null;

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

      {/* Settled status */}
      {isSettled && (
        <div className="bg-app-positive-bg p-4 rounded-xl mb-6 text-center">
          <div className="text-app-positive font-medium text-lg">{t('settleUp.settled')}</div>
          {settlement.status === 'settled_onchain' && settlement.txHash && (
            <div className="mt-2">
              {settlement.explorerUrl ? (
                <a
                  href={settlement.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-tg-link underline"
                >
                  <IconTon size={12} />
                  {t('settlement.viewTransaction')}
                </a>
              ) : (
                <div className="text-xs text-tg-hint">TX: {settlement.txHash.slice(0, 16)}...</div>
              )}
            </div>
          )}
          {settlement.comment && (
            <div className="text-sm text-tg-hint mt-1">{settlement.comment}</div>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Crypto settlement section — debtor only, not settled */}
      {!isSettled && isDebtor && (
        <div className="mb-6">
          <CryptoSettlementUI
            state={cryptoState}
            error={cryptoError}
            walletConnected={walletConnected}
            friendlyAddress={friendlyAddress}
            usdtAmount={usdtAmount}
            totalPayment={totalPayment}
            commission={commission}
            conversionNote={conversionNote}
            recipientName={settlement.to?.displayName ?? ''}
            onPay={handlePayWithUsdt}
            onConfirm={handleConfirmPayment}
            onRetry={handleRetry}
            t={t}
          />
        </div>
      )}

      {/* Manual settlement section */}
      {!isSettled && (isDebtor || isCreditor) && cryptoState === 'idle' && (
        <>
          {isDebtor && (
            <div className="text-center text-sm text-tg-hint mb-4">
              {t('settlement.orSettleManually')}
            </div>
          )}
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
        </>
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

// --- Crypto Settlement UI Component ---

function CryptoSettlementUI({
  state,
  error,
  walletConnected,
  friendlyAddress,
  usdtAmount,
  totalPayment,
  commission,
  conversionNote,
  recipientName,
  onPay,
  onConfirm,
  onRetry,
  t,
}: {
  state: CryptoState;
  error: string | null;
  walletConnected: boolean;
  friendlyAddress: string;
  usdtAmount: string;
  totalPayment: string;
  commission: string;
  conversionNote: string | null;
  recipientName: string;
  onPay: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  t: (key: string, opts?: Record<string, string>) => string;
}) {
  if (state === 'success') {
    return (
      <div className="bg-app-positive-bg p-6 rounded-2xl text-center">
        <div className="text-4xl mb-2">&#10003;</div>
        <div className="text-app-positive font-medium text-lg">{t('settlement.confirmed')}</div>
      </div>
    );
  }

  if (state === 'polling') {
    return (
      <div className="bg-tg-section p-6 rounded-2xl border border-tg-separator text-center">
        <div className="w-8 h-8 border-3 border-tg-button border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="font-medium">{t('settlement.confirming')}</div>
      </div>
    );
  }

  if (state === 'sending') {
    return (
      <div className="bg-tg-section p-6 rounded-2xl border border-tg-separator text-center">
        <div className="w-8 h-8 border-3 border-tg-button border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="font-medium">{t('settlement.waitingWallet')}</div>
      </div>
    );
  }

  if (state === 'confirm') {
    return (
      <div className="bg-tg-section p-4 rounded-2xl border border-tg-separator space-y-3">
        <div className="font-medium">{t('settlement.confirmTitle')}</div>
        {conversionNote && (
          <div className="text-xs text-tg-hint bg-tg-secondary-bg px-3 py-1.5 rounded-lg">
            {conversionNote}
          </div>
        )}
        <p className="text-sm text-tg-hint">
          {t('settlement.confirmBody', {
            amount: usdtAmount,
            recipient: recipientName,
            totalPayment,
            commission,
          })}
        </p>
        <div className="text-xs text-tg-hint">{t('settlement.gasNote')}</div>
        <button
          onClick={onConfirm}
          className="w-full bg-tg-button text-tg-button-text py-4 rounded-xl font-medium flex items-center justify-center gap-2"
        >
          <IconTon size={18} />
          {t('settlement.confirmButton')}
        </button>
      </div>
    );
  }

  if (state === 'error' && error) {
    return (
      <div className="space-y-3">
        <div className="bg-app-negative-bg p-4 rounded-xl">
          <div className="text-app-negative text-sm">{error}</div>
        </div>
        <button
          onClick={onRetry}
          className="w-full border border-tg-separator py-3 rounded-xl font-medium text-sm"
        >
          {t('settlement.tryAgain')}
        </button>
      </div>
    );
  }

  if (state === 'preflight') {
    return (
      <div className="bg-tg-section p-6 rounded-2xl border border-tg-separator text-center">
        <div className="w-6 h-6 border-2 border-tg-button border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <div className="text-sm text-tg-hint">{t('loading')}</div>
      </div>
    );
  }

  // idle state
  return (
    <div className="space-y-2">
      <button
        onClick={onPay}
        className="w-full bg-tg-button text-tg-button-text py-4 rounded-xl font-medium flex items-center justify-center gap-2"
      >
        <IconTon size={18} />
        {walletConnected ? t('settlement.payWithUsdt') : t('account.connectWallet')}
      </button>
      {walletConnected && (
        <div className="text-center text-xs text-tg-hint">
          {truncateAddress(friendlyAddress)} &middot; {t('settlement.gasNote')}
        </div>
      )}
    </div>
  );
}

// --- USDT formatting helpers ---

function calculateCommission(microAmount: number): number {
  const raw = Math.floor(microAmount / 100); // 1%
  return Math.max(100_000, Math.min(1_000_000, raw)); // clamp [0.1, 1.0] USDT
}

function formatUsdtAmount(microAmount: number): string {
  return (microAmount / 1_000_000).toFixed(2);
}

function formatUsdtCommission(microAmount: number): string {
  return formatUsdtAmount(calculateCommission(microAmount));
}
