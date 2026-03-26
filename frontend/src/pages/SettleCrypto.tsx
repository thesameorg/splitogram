import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type SettlementTxParams } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { useSettlement } from '../hooks/useSettlement';
import { useTonWallet } from '../hooks/useTonWallet';
import { formatAmount } from '../utils/format';
import { calculateCommission } from '../utils/commission';
import { getCurrency } from '../utils/currencies';
import {
  buildSettlementBody,
  truncateAddress,
  toFriendly,
  formatUsdtAmount,
  formatUsdtCommission,
  formatTonAmount,
} from '../utils/ton';
import { sanitizeDecimalInput } from '../utils/input';
import { config } from '../config';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { IconTon, IconExternalLink, IconChevron } from '../icons';
import { openExternalLink } from '../utils/links';

const isTestnet = config.tonNetwork !== 'mainnet';

type CryptoState = 'idle' | 'preflight' | 'confirm' | 'sending' | 'polling' | 'success' | 'error';

export function SettleCrypto() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const settlementId = parseInt(id ?? '', 10);

  const { settlement, setSettlement, loading, error, setError, amountStr, setAmountStr } =
    useSettlement(settlementId);

  // Crypto settlement state
  const [cryptoState, setCryptoState] = useState<CryptoState>('idle');
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [txParams, setTxParams] = useState<SettlementTxParams | null>(null);
  const [cryptoCustomAmount, setCryptoCustomAmount] = useState<number | undefined>(undefined);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    connected: walletConnected,
    rawAddress,
    friendlyAddress,
    tonConnectUI,
    openModal,
  } = useTonWallet();

  const backPath = settlement ? `/groups/${settlement.groupId}?tab=balances` : undefined;
  useTelegramBackButton(true, backPath);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const isDebtor = settlement?.currentUserId === settlement?.fromUser;
  const isSettled =
    settlement?.status === 'settled_onchain' || settlement?.status === 'settled_external';
  const isPending = settlement?.status === 'payment_pending';

  function getCustomAmountMicro(): number | undefined {
    const parsed = parseFloat(amountStr);
    if (isNaN(parsed) || parsed <= 0) return undefined;
    const micro = Math.round(parsed * 1_000_000);
    return micro !== settlement!.amount ? micro : undefined;
  }

  async function handlePayWithUsdt() {
    setCryptoError(null);

    const parsed = parseFloat(amountStr);
    if (isNaN(parsed) || parsed <= 0) {
      setCryptoError(t('settleUp.invalidAmount'));
      setCryptoState('error');
      return;
    }

    if (!walletConnected || !rawAddress) {
      openModal();
      return;
    }

    const customAmount = getCustomAmountMicro();
    setCryptoCustomAmount(customAmount);
    setCryptoState('preflight');
    try {
      const params = await api.getSettlementTx(settlementId, rawAddress, customAmount);
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

      try {
        await api.verifySettlement(settlementId, result.boc, cryptoCustomAmount);
      } catch {
        // Backend may fail to receive, but tx is already on-chain
      }

      setSettlement((prev) => (prev ? { ...prev, status: 'payment_pending' } : prev));
      startPolling();
    } catch (err: any) {
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
    const MAX_POLL = 120000;

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
          setTimeout(
            () => navigate(`/groups/${settlement!.groupId}?tab=balances`, { replace: true }),
            2000,
          );
        } else if (result.status === 'open') {
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

  // Detect wallet disconnect during crypto flow
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
    setCryptoCustomAmount(undefined);
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
        setTimeout(
          () => navigate(`/groups/${settlement!.groupId}?tab=balances`, { replace: true }),
          2000,
        );
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

  // Only debtor can use crypto settlement
  if (!isDebtor && !isPending && !isSettled) {
    return (
      <PageLayout>
        <div className="text-center py-12">
          <p className="text-tg-hint">{t('settleUp.notFound')}</p>
        </div>
      </PageLayout>
    );
  }

  const usdtAmount = txParams
    ? formatUsdtAmount(txParams.amount)
    : formatUsdtAmount(settlement.amount);
  const commission = txParams
    ? formatUsdtAmount(txParams.commission)
    : formatUsdtCommission(settlement.amount);
  const totalPayment = txParams
    ? formatUsdtAmount(txParams.totalAmount)
    : formatUsdtAmount(settlement.amount + calculateCommission(settlement.amount));

  const conversionNote =
    txParams && txParams.originalCurrency !== 'USD'
      ? `${formatAmount(txParams.originalAmount, txParams.originalCurrency)} ≈ ${formatUsdtAmount(txParams.amount)} USDT`
      : null;

  const gasAttachDisplay = txParams ? formatTonAmount(Number(txParams.gasAttach)) : null;
  const estimatedGasBurnDisplay = txParams?.estimatedGasBurn
    ? formatTonAmount(Number(txParams.estimatedGasBurn))
    : null;

  return (
    <PageLayout>
      <h1 className="text-xl font-extrabold mb-6">{t('settlement.payWithUsdt')}</h1>

      {isTestnet && (
        <div className="bg-app-warning-bg border border-app-warning/30 rounded-xl px-4 py-2 mb-4 text-center">
          <span className="text-app-warning text-sm font-medium">
            {t('settlement.testnetWarning')}
          </span>
        </div>
      )}

      {/* Settlement info */}
      <div className="card px-4 py-3 rounded-2xl mb-4 flex items-center justify-between">
        <span className="text-sm text-tg-hint">
          {t('settleUp.youOwe', { name: settlement.to?.displayName })}
        </span>
        <span className="text-lg font-bold">
          {formatAmount(settlement.amount, settlement.currency)}
        </span>
      </div>

      {/* Settled status */}
      {isSettled && settlement.status === 'settled_onchain' && (
        <div className="bg-app-positive-bg p-4 rounded-xl mb-6">
          <div className="flex items-center justify-center gap-2 mb-1">
            <IconTon size={16} className="text-app-positive" />
            <span className="text-app-positive font-medium text-lg">{t('settleUp.settled')}</span>
          </div>
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
            {settlement.txHash && settlement.explorerUrl && (
              <div className="pt-1">
                <button
                  onClick={(e) => openExternalLink(settlement.explorerUrl!, e)}
                  className="inline-flex items-center gap-1.5 text-xs text-tg-link"
                >
                  <IconTon size={12} />
                  {t('settlement.viewTransaction')}
                  <IconExternalLink size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Crypto settlement UI */}
      {!isSettled && (
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
          estimatedGasBurnDisplay={estimatedGasBurnDisplay}
          walletUninit={txParams?.walletUninit ?? false}
          isTestnet={isTestnet}
          pollElapsed={pollElapsed}
          pendingSince={isPending ? settlement.updatedAt : null}
          amountStr={amountStr}
          onAmountChange={(v) => setAmountStr(sanitizeDecimalInput(v))}
          currencySymbol={getCurrency(settlement.currency).symbol}
          debtAmount={formatAmount(settlement.amount, settlement.currency)}
          senderHasWallet={!!walletConnected}
          recipientHasWallet={!!settlement.to?.walletAddress}
          onPay={handlePayWithUsdt}
          onConfirm={handleConfirmPayment}
          onRetry={handleRetry}
          onRefresh={() => startPolling()}
          onManualVerify={handleManualVerify}
          onCancel={handleCancelPending}
          t={t}
        />
      )}
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
  estimatedGasBurnDisplay,
  walletUninit,
  recipientName,
  isTestnet: testnet,
  pollElapsed,
  pendingSince,
  amountStr,
  onAmountChange,
  currencySymbol,
  debtAmount,
  senderHasWallet,
  recipientHasWallet,
  onPay,
  onConfirm,
  onRetry,
  onRefresh,
  onManualVerify,
  onCancel,
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
  estimatedGasBurnDisplay: string | null;
  walletUninit: boolean;
  recipientName: string;
  isTestnet: boolean;
  pollElapsed: number;
  pendingSince: string | null;
  amountStr: string;
  onAmountChange: (value: string) => void;
  currencySymbol: string;
  debtAmount: string;
  senderHasWallet: boolean;
  recipientHasWallet: boolean;
  onPay: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onManualVerify: (txLink: string) => void;
  onCancel: () => void;
  t: (key: string, opts?: Record<string, string>) => string;
}) {
  const testnetBadge = testnet ? ' (TESTNET)' : '';
  const CANCEL_THRESHOLD_MS = 10 * 60 * 1000;
  const canCancel =
    pendingSince && Date.now() - new Date(pendingSince).getTime() > CANCEL_THRESHOLD_MS;

  if (state === 'success') {
    return (
      <div className="bg-app-positive-bg p-8 rounded-2xl text-center">
        <div className="text-5xl mb-3">&#127881;</div>
        <div className="text-app-positive font-bold text-xl mb-1">{t('settlement.confirmed')}</div>
        <div className="text-app-positive/70 text-sm">
          {usdtAmount} USDT &rarr; {recipientName}
        </div>
        {estimatedGasBurnDisplay && (
          <div className="text-app-positive/50 text-xs mt-2">
            {t('settlement.gasBurntResult', { amount: estimatedGasBurnDisplay })}
          </div>
        )}
      </div>
    );
  }

  if (state === 'polling') {
    const elapsedSec = Math.floor(pollElapsed / 1000);
    const senderAddr = walletConnected && friendlyAddress ? friendlyAddress : null;
    const viewerBase = testnet ? 'https://testnet.tonviewer.com' : 'https://tonviewer.com';
    return (
      <div className="card p-6 rounded-2xl text-center">
        <div className="w-8 h-8 border-3 border-tg-button border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="font-medium">{t('settlement.confirming')}</div>
        <div className="text-xs text-tg-hint mt-1">
          {t('settlement.confirmingElapsed', { seconds: String(elapsedSec) })}
        </div>
        {senderAddr && (
          <button
            onClick={(e) => openExternalLink(`${viewerBase}/${senderAddr}`, e)}
            className="inline-flex items-center gap-1 text-xs text-tg-link mt-2"
          >
            <IconTon size={10} />
            {t('settlement.viewWalletTxns')}
          </button>
        )}
        {canCancel && (
          <button onClick={onCancel} className="mt-3 text-sm text-tg-destructive">
            {t('settlement.cancelPending')}
          </button>
        )}
      </div>
    );
  }

  if (state === 'sending') {
    return (
      <div className="card p-6 rounded-2xl text-center">
        <div className="w-8 h-8 border-3 border-tg-button border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="font-medium">{t('settlement.waitingWallet')}</div>
      </div>
    );
  }

  if (state === 'confirm') {
    return (
      <div className="card p-4 rounded-2xl space-y-3">
        <div className="font-medium">{t('settlement.confirmTitle')}</div>
        {conversionNote && (
          <div className="text-xs text-tg-hint bg-tg-secondary-bg px-3 py-1.5 rounded-xl">
            {conversionNote}
          </div>
        )}

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
          <div className="flex justify-between font-medium pt-1.5 border-t border-ghost">
            <span>{t('settlement.lineTotal')}</span>
            <span>{totalPayment} USDT</span>
          </div>
        </div>

        {gasAttachDisplay && (
          <div className="text-xs bg-tg-secondary-bg px-3 py-2 rounded-xl space-y-1">
            {estimatedGasBurnDisplay && (
              <div className="flex justify-between">
                <span className="text-tg-hint">{t('settlement.gasBurnEstimate')}</span>
                <span className="text-tg-hint">~{estimatedGasBurnDisplay} TON</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-tg-hint">{t('settlement.gasFreeze')}</span>
              <span className="text-tg-hint">~{gasAttachDisplay} TON</span>
            </div>
            <div className="text-tg-hint/60 mt-1">{t('settlement.gasFreezeNote')}</div>
            {walletUninit && (
              <div className="text-tg-hint/60 mt-0.5">{t('settlement.walletActivation')}</div>
            )}
          </div>
        )}

        <button
          onClick={onConfirm}
          className="w-full bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white py-4 rounded-xl font-medium flex items-center justify-center gap-2"
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
            className="w-full border border-ghost py-3 rounded-xl font-medium text-sm"
          >
            {t('settlement.tryAgain')}
          </button>
        )}
        {canCancel && (
          <button onClick={onCancel} className="w-full py-3 rounded-xl text-sm text-tg-destructive">
            {t('settlement.cancelPending')}
          </button>
        )}
      </div>
    );
  }

  if (state === 'preflight') {
    return (
      <div className="card p-6 rounded-2xl text-center">
        <div className="w-6 h-6 border-2 border-tg-button border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  const walletsReady = senderHasWallet && recipientHasWallet;

  // idle state
  return (
    <div className="space-y-3">
      {/* Wallet requirement warning */}
      {!walletsReady && (
        <div className="bg-app-warning-bg border border-app-warning/20 rounded-xl px-4 py-3">
          <p className="text-sm text-app-warning">{t('settlement.bothWalletsRequired')}</p>
          {!senderHasWallet && (
            <p className="text-xs text-app-warning/70 mt-1">{t('settlement.yourWalletMissing')}</p>
          )}
          {!recipientHasWallet && (
            <p className="text-xs text-app-warning/70 mt-1">
              {t('settlement.recipientWalletMissing', { name: recipientName })}
            </p>
          )}
        </div>
      )}

      {/* Editable amount */}
      <div>
        <label className="block text-sm font-medium mb-1 text-tg-hint tracking-label">
          {t('settleUp.amount')}
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-tg-hint">
            {currencySymbol}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => onAmountChange(e.target.value)}
            className="w-full p-3 pl-8 border border-ghost rounded-xl bg-app-card-nested"
          />
        </div>
        <div className="text-xs text-tg-hint mt-1">
          {t('settleUp.debtAmount')}: {debtAmount}
        </div>
      </div>

      <button
        onClick={onPay}
        disabled={!walletsReady}
        className="w-full bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white py-4 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <IconTon size={18} />
        {walletConnected
          ? `${t('settlement.payWithUsdt')}${testnetBadge}`
          : t('account.connectWallet')}
      </button>
      {walletConnected && (
        <div className="text-center text-xs text-tg-hint">
          {truncateAddress(friendlyAddress)}
          {gasAttachDisplay
            ? ` · ${t('settlement.gasAttachShort', { amount: gasAttachDisplay })}`
            : ` · ${t('settlement.gasNote')}`}
        </div>
      )}

      {/* Inline help section */}
      <HowItWorks t={t} />
    </div>
  );
}

// --- Collapsible "How it works" section ---

function HowItWorks({ t }: { t: (key: string) => string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-ghost overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-tg-hint"
      >
        <span>{t('settlement.infoTitle')}</span>
        <IconChevron size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 text-xs text-tg-hint">
          <p>{t('settlement.infoHow')}</p>
          <p>{t('settlement.infoCommission')}</p>
          <p>{t('settlement.infoGas')}</p>
          <p className="text-tg-hint/60">{t('settlement.infoContract')}</p>
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
        className="w-full bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white py-3 rounded-xl font-medium text-sm"
      >
        {t('settlement.refreshStatus')}
      </button>
      <div className="text-center text-xs text-tg-hint py-1">{t('settlement.orPasteTx')}</div>
      <input
        type="text"
        value={txLink}
        onChange={(e) => setTxLink(e.target.value)}
        placeholder={t('settlement.txLinkPlaceholder')}
        className="w-full p-3 border border-ghost rounded-xl bg-app-card-nested text-sm"
      />
      <button
        onClick={() => txLink.trim() && onSubmit(txLink.trim())}
        disabled={!txLink.trim()}
        className="w-full border border-ghost py-3 rounded-xl font-medium text-sm disabled:opacity-40"
      >
        {t('settlement.verifyTx')}
      </button>
    </div>
  );
}
