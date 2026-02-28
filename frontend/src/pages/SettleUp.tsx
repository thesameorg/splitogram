import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type SettlementDetail } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { formatAmount } from '../utils/format';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';

export function SettleUp() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const settlementId = parseInt(id ?? '', 10);

  const [settlement, setSettlement] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useTelegramBackButton(true);

  useEffect(() => {
    if (isNaN(settlementId)) return;
    api
      .getSettlement(settlementId)
      .then((data) => {
        setSettlement(data);
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

  async function handleMarkSettled() {
    setError(null);
    setSubmitting(true);
    try {
      await api.markExternal(settlementId, comment.trim() || undefined);
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
          <p className="text-red-500">{error || 'Settlement not found'}</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">Settle Up</h1>

      {/* Settlement info */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 mb-6 text-center">
        <div className="text-sm text-gray-500 mb-2">
          {isDebtor ? (
            <>
              You owe <span className="font-medium">{settlement.to?.displayName}</span>
            </>
          ) : isCreditor ? (
            <>
              <span className="font-medium">{settlement.from?.displayName}</span> owes you
            </>
          ) : (
            <>
              {settlement.from?.displayName} owes {settlement.to?.displayName}
            </>
          )}
        </div>
        <div className="text-3xl font-bold mb-1">
          {formatAmount(settlement.amount, settlement.currency)}
        </div>
      </div>

      {/* Status */}
      {isSettled && (
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-xl mb-6 text-center">
          <div className="text-green-600 dark:text-green-400 font-medium text-lg">Settled</div>
          {settlement.comment && (
            <div className="text-sm text-gray-500 mt-1">{settlement.comment}</div>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Actions */}
      {!isSettled && (isDebtor || isCreditor) && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-600 dark:text-gray-400">
              Note (optional)
            </label>
            <input
              type="text"
              placeholder="e.g., paid via bank transfer"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-transparent"
            />
          </div>

          <button
            onClick={handleMarkSettled}
            disabled={submitting}
            className="w-full bg-blue-500 text-white py-4 rounded-xl font-medium disabled:opacity-50"
          >
            {submitting ? 'Settling...' : isDebtor ? 'Mark as Paid' : 'Mark as Received'}
          </button>
        </div>
      )}
    </PageLayout>
  );
}
