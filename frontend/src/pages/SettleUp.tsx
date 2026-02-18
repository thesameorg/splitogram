import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { api } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';

function formatAmount(microUsdt: number): string {
  return `$${(microUsdt / 1_000_000).toFixed(2)}`;
}

export function SettleUp() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const settlementId = parseInt(id ?? '', 10);
  const [tonConnectUI] = useTonConnectUI();
  const walletAddress = useTonAddress();

  const [settlement, setSettlement] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  useTelegramBackButton(true);

  useEffect(() => {
    if (isNaN(settlementId)) return;
    api.getSettlement(settlementId).then((data) => {
      setSettlement(data);
      setStatus(data.status);
      setLoading(false);
    }).catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, [settlementId]);

  // Sync wallet address to backend
  useEffect(() => {
    if (walletAddress) {
      api.setWallet(walletAddress).catch(console.error);
    }
  }, [walletAddress]);

  async function handlePayWithTon() {
    if (!walletAddress) {
      tonConnectUI.openModal();
      return;
    }

    setSending(true);
    setError(null);
    try {
      const txParams = await api.getSettlementTx(settlementId);

      // Build Jetton transfer message
      // For Phase 1 on testnet, we send a simple TON transfer with comment
      // Full Jetton transfer requires @ton/ton Cell building
      const tx = {
        validUntil: Math.floor(Date.now() / 1000) + 360,
        messages: [
          {
            address: txParams.recipientAddress,
            amount: String(txParams.amount), // micro-USDT as nano-TON for testnet simulation
            payload: btoa(txParams.comment), // base64 encoded comment
          },
        ],
      };

      const result = await tonConnectUI.sendTransaction(tx);

      // Verify the transaction
      setVerifying(true);
      const verifyResult = await api.verifySettlement(settlementId, {
        boc: result.boc,
      });

      setStatus(verifyResult.status);

      if (verifyResult.status === 'settled_onchain') {
        // Success!
        setTimeout(() => navigate(-1), 1500);
      } else {
        // Poll for confirmation
        pollSettlement();
      }
    } catch (err: any) {
      setError(err.message || 'Transaction failed');
    } finally {
      setSending(false);
      setVerifying(false);
    }
  }

  async function pollSettlement() {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const data = await api.getSettlement(settlementId);
        setStatus(data.status);
        if (data.status === 'settled_onchain' || data.status === 'settled_external') {
          setTimeout(() => navigate(-1), 1500);
          return;
        }
      } catch {
        break;
      }
    }
  }

  async function handleMarkExternal() {
    setError(null);
    try {
      const result = await api.markExternal(settlementId);
      setStatus(result.status);
      setTimeout(() => navigate(-1), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to mark as settled');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!settlement) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500">{error || 'Settlement not found'}</p>
      </div>
    );
  }

  const isSettled = status === 'settled_onchain' || status === 'settled_external';

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-6">Settle Up</h1>

      {/* Settlement info */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 mb-6 text-center">
        <div className="text-sm text-gray-500 mb-2">
          {settlement.from?.displayName} owes {settlement.to?.displayName}
        </div>
        <div className="text-3xl font-bold mb-2">{formatAmount(settlement.amount)}</div>
        <div className="text-sm text-gray-500">USDT</div>
      </div>

      {/* Status */}
      {isSettled && (
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-xl mb-6 text-center">
          <div className="text-green-600 dark:text-green-400 font-medium text-lg">
            {status === 'settled_onchain' ? 'Settled on-chain' : 'Settled externally'}
          </div>
          {settlement.txHash && (
            <div className="text-xs text-gray-500 mt-1">
              Tx: {settlement.txHash.slice(0, 20)}...
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl mb-4 text-sm">
          {error}
        </div>
      )}

      {status === 'payment_pending' && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl mb-6 text-center">
          <div className="text-yellow-600 dark:text-yellow-400 font-medium">
            {verifying ? 'Verifying transaction...' : 'Payment pending'}
          </div>
          <button
            onClick={pollSettlement}
            className="mt-2 text-sm text-blue-500 underline"
          >
            Refresh status
          </button>
        </div>
      )}

      {/* Actions */}
      {!isSettled && status !== 'payment_pending' && (
        <div className="space-y-3">
          {/* Pay with TON */}
          <button
            onClick={handlePayWithTon}
            disabled={sending}
            className="w-full bg-blue-500 text-white py-4 rounded-xl font-medium disabled:opacity-50"
          >
            {sending ? 'Sending...' : walletAddress ? 'Pay with TON Wallet' : 'Connect Wallet to Pay'}
          </button>

          {walletAddress && (
            <div className="text-center text-xs text-gray-500">
              Wallet: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </div>
          )}

          {/* Mark as settled externally — only visible to creditor */}
          <div className="text-center pt-4">
            <button
              onClick={handleMarkExternal}
              className="text-sm text-gray-500 underline"
            >
              Settled outside the app?
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
