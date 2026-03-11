import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type SettlementDetail, type SettlementTxParams } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { useTonWallet } from '../hooks/useTonWallet';
import { formatAmount } from '../utils/format';
import { calculateCommission } from '../utils/commission';
import { getCurrency } from '../utils/currencies';
import { buildSettlementBody, truncateAddress, toFriendly } from '../utils/ton';
import {
  validateImageFile,
  processReceipt,
  processReceiptThumbnail,
  imageUrl,
} from '../utils/image';
import { sanitizeDecimalInput } from '../utils/input';
import { config } from '../config';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { BottomSheet } from '../components/BottomSheet';
import { ReportImage } from '../components/ReportImage';
import { IconTon } from '../icons';

const isTestnet = config.tonNetwork !== 'mainnet';

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
  const [showCryptoInfo, setShowCryptoInfo] = useState(false);
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
      console.log('[settlement:preflight]', {
        settlementId,
        from: rawAddress,
        to: params.recipientAddress,
        walletVersion: params.walletVersion,
        walletUninit: params.walletUninit,
        amountUsdt: params.amount,
        totalUsdt: params.totalAmount,
        commission: params.commission,
        gasAttach: params.gasAttach,
      });
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
      } else if (code === 'insufficient_usdt') {
        setCryptoError(
          t('settlement.insufficientUsdt', {
            balance: formatUsdtAmount(err.balance ?? 0),
            required: formatUsdtAmount(err.required ?? settlement!.amount),
          }),
        );
      } else if (code === 'insufficient_ton') {
        setCryptoError(
          t('settlement.insufficientTon', {
            balance: formatTonAmount(err.tonBalance ?? 0),
            required: formatTonAmount(err.tonRequired ?? 0),
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

      console.log('[settlement:sending]', {
        settlementId,
        to: toFriendly(txParams.senderJettonWallet),
        gasAttach: txParams.gasAttach,
        walletVersion: txParams.walletVersion,
      });

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

      console.log('[settlement:sent]', {
        settlementId,
        bocLength: result.boc?.length,
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

  const [pollElapsed, setPollElapsed] = useState(0);

  const startPolling = useCallback(() => {
    setCryptoState('polling');
    let elapsed = 0;
    setPollElapsed(0);
    const POLL_INTERVAL = 3000;
    const MAX_POLL = 120000; // 2 minutes

    pollingRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      setPollElapsed(elapsed);
      try {
        const result = await api.confirmSettlement(settlementId);

        console.log('[settlement:poll]', { settlementId, elapsed, status: result.status });

        if (result.status === 'settled_onchain') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          console.log('[settlement:confirmed]', { settlementId, txHash: result.txHash });
          setSettlement((prev) =>
            prev ? { ...prev, status: 'settled_onchain', txHash: result.txHash ?? null } : prev,
          );
          setCryptoState('success');
          setTimeout(() => navigate(-1), 2000);
        } else if (result.status === 'open') {
          // Rolled back (timeout)
          if (pollingRef.current) clearInterval(pollingRef.current);
          console.log('[settlement:rolled-back]', { settlementId });
          setSettlement((prev) => (prev ? { ...prev, status: 'open' } : prev));
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

  // Detect wallet disconnect during crypto flow (preflight/confirm stages)
  useEffect(() => {
    if (!walletConnected && (cryptoState === 'preflight' || cryptoState === 'confirm')) {
      setCryptoError(t('settlement.walletDisconnected'));
      setCryptoState('error');
      setTxParams(null);
    }
  }, [walletConnected, cryptoState, t]);

  function handleRetry() {
    setCryptoState('idle');
    setCryptoError(null);
    setTxParams(null);
  }

  async function handleCancelPending() {
    if (!window.confirm(t('settlement.confirmCancel'))) return;
    try {
      await api.cancelSettlement(settlementId);
      setSettlement((prev) => (prev ? { ...prev, status: 'open' } : prev));
      setCryptoState('idle');
      setCryptoError(null);
      if (pollingRef.current) clearInterval(pollingRef.current);
    } catch (err: any) {
      setCryptoError(err.message || 'Failed to cancel');
    }
  }

  async function handleManualVerify(txLink: string) {
    setCryptoState('polling');
    setCryptoError(null);
    setPollElapsed(0);
    try {
      const result = await api.confirmSettlement(settlementId, txLink);
      if (result.status === 'settled_onchain') {
        setSettlement((prev) =>
          prev ? { ...prev, status: 'settled_onchain', txHash: result.txHash ?? null } : prev,
        );
        setCryptoState('success');
        setTimeout(() => navigate(-1), 2000);
      } else {
        setCryptoError(t('settlement.txNotFound'));
        setCryptoState('error');
      }
    } catch {
      setCryptoError(t('settlement.txNotFound'));
      setCryptoState('error');
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

  // Gas amount for display (total attached — excess refunded automatically)
  const gasAttachDisplay = txParams ? formatTonAmount(Number(txParams.gasAttach)) : null;

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">{t('settleUp.title')}</h1>

      {isTestnet && (
        <div className="bg-app-warning-bg border border-app-warning/30 rounded-xl px-4 py-2 mb-4 text-center">
          <span className="text-app-warning text-sm font-medium">
            {t('settlement.testnetWarning')}
          </span>
        </div>
      )}

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
        <div className="bg-app-positive-bg p-4 rounded-xl mb-6">
          <div className="flex items-center justify-center gap-2 mb-1">
            {settlement.status === 'settled_onchain' ? (
              <IconTon size={16} className="text-app-positive" />
            ) : (
              <svg
                className="w-4 h-4 text-app-positive"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span className="text-app-positive font-medium text-lg">{t('settleUp.settled')}</span>
          </div>

          {/* On-chain details */}
          {settlement.status === 'settled_onchain' && (
            <div className="mt-3 pt-3 border-t border-app-positive/20 space-y-2">
              {settlement.usdtAmount != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-app-positive/70">USDT</span>
                  <span className="text-app-positive font-medium">
                    {formatUsdtAmount(settlement.usdtAmount)} USDT
                  </span>
                </div>
              )}
              {settlement.commission != null && settlement.commission > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-app-positive/70">{t('settlement.commissionLabel')}</span>
                  <span className="text-app-positive/70">
                    {formatUsdtAmount(settlement.commission)} USDT
                  </span>
                </div>
              )}
              {settlement.txHash && (
                <div className="pt-1">
                  {settlement.explorerUrl ? (
                    <a
                      href={settlement.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-tg-link"
                    >
                      <IconTon size={12} />
                      {t('settlement.viewTransaction')}
                      <svg
                        className="w-3 h-3"
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
                    </a>
                  ) : (
                    <div className="text-xs text-tg-hint">
                      TX: {settlement.txHash.slice(0, 16)}...
                    </div>
                  )}
                </div>
              )}
            </div>
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
            gasAttachDisplay={gasAttachDisplay}
            walletUninit={txParams?.walletUninit ?? false}
            isTestnet={isTestnet}
            pollElapsed={pollElapsed}
            pendingSince={isPending ? settlement.updatedAt : null}
            onPay={handlePayWithUsdt}
            onConfirm={handleConfirmPayment}
            onRetry={handleRetry}
            onRefresh={() => startPolling()}
            onManualVerify={handleManualVerify}
            onCancel={handleCancelPending}
            onInfo={() => setShowCryptoInfo(true)}
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
              onClick={() => {
                const msg = isDebtor
                  ? t('settleUp.confirmMarkPaid')
                  : t('settleUp.confirmMarkReceived');
                if (window.confirm(msg)) handleMarkSettled();
              }}
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

      {/* Crypto info */}
      <BottomSheet
        open={showCryptoInfo}
        onClose={() => setShowCryptoInfo(false)}
        title={t('settlement.infoTitle')}
      >
        <div className="space-y-3 text-sm text-tg-text">
          <p>{t('settlement.infoHow')}</p>
          <p>{t('settlement.infoCommission')}</p>
          <p>{t('settlement.infoGas')}</p>
          <p className="text-tg-hint text-xs">{t('settlement.infoContract')}</p>
        </div>
      </BottomSheet>
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
  gasAttachDisplay,
  walletUninit,
  recipientName,
  isTestnet: testnet,
  pollElapsed,
  pendingSince,
  onPay,
  onConfirm,
  onRetry,
  onRefresh,
  onManualVerify,
  onCancel,
  onInfo,
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
  gasAttachDisplay: string | null;
  walletUninit: boolean;
  recipientName: string;
  isTestnet: boolean;
  pollElapsed: number;
  pendingSince: string | null;
  onPay: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onManualVerify: (txLink: string) => void;
  onCancel: () => void;
  onInfo: () => void;
  t: (key: string, opts?: Record<string, string>) => string;
}) {
  const testnetBadge = testnet ? ' (TESTNET)' : '';
  const CANCEL_THRESHOLD_MS = 10 * 60 * 1000;
  const canCancel =
    pendingSince && Date.now() - new Date(pendingSince).getTime() > CANCEL_THRESHOLD_MS;
  if (state === 'success') {
    // TODO: replace with Lottie celebration animation
    return (
      <div className="bg-app-positive-bg p-8 rounded-2xl text-center">
        <div className="text-5xl mb-3">&#127881;</div>
        <div className="text-app-positive font-bold text-xl mb-1">{t('settlement.confirmed')}</div>
        <div className="text-app-positive/70 text-sm">
          {usdtAmount} USDT &rarr; {recipientName}
        </div>
      </div>
    );
  }

  if (state === 'polling') {
    const elapsedSec = Math.floor(pollElapsed / 1000);
    const senderAddr = walletConnected && friendlyAddress ? friendlyAddress : null;
    const viewerBase = testnet ? 'https://testnet.tonviewer.com' : 'https://tonviewer.com';
    return (
      <div className="bg-tg-section p-6 rounded-2xl border border-tg-separator text-center">
        <div className="w-8 h-8 border-3 border-tg-button border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="font-medium">{t('settlement.confirming')}</div>
        <div className="text-xs text-tg-hint mt-1">
          {t('settlement.confirmingElapsed', { seconds: String(elapsedSec) })}
        </div>
        {senderAddr && (
          <a
            href={`${viewerBase}/${senderAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-tg-link mt-2"
          >
            <IconTon size={10} />
            {t('settlement.viewWalletTxns')}
          </a>
        )}
        {canCancel && (
          <button
            onClick={onCancel}
            className="mt-3 text-sm text-tg-destructive"
          >
            {t('settlement.cancelPending')}
          </button>
        )}
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

        {/* Payment breakdown */}
        <div className="text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-tg-hint">
              {t('settlement.lineRecipient', { name: recipientName })}
            </span>
            <span>{usdtAmount} USDT</span>
          </div>
          <div className="flex justify-between">
            <span className="text-tg-hint">{t('settlement.commissionLabel')}</span>
            <span>{commission} USDT</span>
          </div>
          <div className="flex justify-between font-medium pt-1.5 border-t border-tg-separator">
            <span>{t('settlement.lineTotal')}</span>
            <span>{totalPayment} USDT</span>
          </div>
        </div>

        {/* Gas fee */}
        {gasAttachDisplay && (
          <div className="text-xs bg-tg-secondary-bg px-3 py-2 rounded-lg">
            <div className="flex justify-between">
              <span className="text-tg-hint">{t('settlement.lineGas')}</span>
              <span className="text-tg-hint">~{gasAttachDisplay} TON</span>
            </div>
            <div className="text-tg-hint/60 mt-1">{t('settlement.gasRefund')}</div>
            {walletUninit && (
              <div className="text-tg-hint/60 mt-0.5">{t('settlement.walletActivation')}</div>
            )}
          </div>
        )}

        <button
          onClick={onConfirm}
          className="w-full bg-tg-button text-tg-button-text py-4 rounded-xl font-medium flex items-center justify-center gap-2"
        >
          <IconTon size={18} />
          {t('settlement.confirmButton')}
          {testnetBadge}
        </button>
      </div>
    );
  }

  if (state === 'error' && error) {
    const isPendingTimeout = error === t('settlement.txPending');
    const isTxNotFound = error === t('settlement.txNotFound');
    const showTxInput = isPendingTimeout || isTxNotFound;
    return (
      <div className="space-y-3">
        <div
          className={`${isPendingTimeout ? 'bg-app-warning-bg' : 'bg-app-negative-bg'} p-4 rounded-xl`}
        >
          <div className={`${isPendingTimeout ? 'text-app-warning' : 'text-app-negative'} text-sm`}>
            {error}
          </div>
        </div>
        {showTxInput ? (
          <TxLinkInput onSubmit={onManualVerify} onRefresh={onRefresh} t={t} />
        ) : (
          <button
            onClick={onRetry}
            className="w-full border border-tg-separator py-3 rounded-xl font-medium text-sm"
          >
            {t('settlement.tryAgain')}
          </button>
        )}
        {canCancel && (
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl text-sm text-tg-destructive"
          >
            {t('settlement.cancelPending')}
          </button>
        )}
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
      <div className="flex gap-2">
        <button
          onClick={onPay}
          className="flex-1 bg-tg-button text-tg-button-text py-4 rounded-xl font-medium flex items-center justify-center gap-2"
        >
          <IconTon size={18} />
          {walletConnected
            ? `${t('settlement.payWithUsdt')}${testnetBadge}`
            : t('account.connectWallet')}
        </button>
        <button
          onClick={onInfo}
          className="px-4 py-4 rounded-xl border border-tg-separator text-tg-hint font-medium text-sm"
          aria-label="Info"
        >
          ?
        </button>
      </div>
      {walletConnected && (
        <div className="text-center text-xs text-tg-hint">
          {truncateAddress(friendlyAddress)}
          {gasAttachDisplay
            ? ` · ${t('settlement.gasAttachShort', { amount: gasAttachDisplay })}`
            : ` · ${t('settlement.gasNote')}`}
        </div>
      )}
    </div>
  );
}

// --- Tx link input for manual verification ---

function TxLinkInput({
  onSubmit,
  onRefresh,
  t,
}: {
  onSubmit: (txLink: string) => void;
  onRefresh: () => void;
  t: (key: string) => string;
}) {
  const [txLink, setTxLink] = useState('');

  return (
    <div className="space-y-2">
      <button
        onClick={onRefresh}
        className="w-full bg-tg-button text-tg-button-text py-3 rounded-xl font-medium text-sm"
      >
        {t('settlement.refreshStatus')}
      </button>
      <div className="text-center text-xs text-tg-hint py-1">{t('settlement.orPasteTx')}</div>
      <input
        type="text"
        value={txLink}
        onChange={(e) => setTxLink(e.target.value)}
        placeholder={t('settlement.txLinkPlaceholder')}
        className="w-full p-3 border border-tg-separator rounded-xl bg-transparent text-sm"
      />
      <button
        onClick={() => txLink.trim() && onSubmit(txLink.trim())}
        disabled={!txLink.trim()}
        className="w-full border border-tg-separator py-3 rounded-xl font-medium text-sm disabled:opacity-40"
      >
        {t('settlement.verifyTx')}
      </button>
    </div>
  );
}

// --- USDT formatting helpers ---

function formatUsdtAmount(microAmount: number): string {
  return (microAmount / 1_000_000).toFixed(2);
}

function formatUsdtCommission(microAmount: number): string {
  return formatUsdtAmount(calculateCommission(microAmount));
}

function formatTonAmount(nanoTon: number): string {
  return (nanoTon / 1_000_000_000).toFixed(2);
}
