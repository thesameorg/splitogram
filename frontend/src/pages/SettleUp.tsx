import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type SettlementDetail } from '../services/api';
import { useTelegramBackButton } from '../hooks/useTelegramBackButton';
import { formatAmount } from '../utils/format';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorBanner } from '../components/ErrorBanner';

export function SettleUp() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
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
    </PageLayout>
  );
}
