import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type ActivityItem } from '../services/api';
import { formatAmount } from '../utils/format';
import { getActivityText } from '../utils/activity';
import { timeAgo } from '../utils/time';
import { PageLayout } from '../components/PageLayout';
import { LoadingScreen } from '../components/LoadingScreen';
import { Avatar } from '../components/Avatar';
import { IconTon } from '../icons';
import { openExternalLink } from '../utils/links';

export function Activity() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [activityData, meData] = await Promise.all([api.getActivity(), api.getMe()]);
      setItems(activityData.items);
      setNextCursor(activityData.nextCursor);
      setCurrentUserId(meData.id);
    } catch (err) {
      console.error('Failed to load activity:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.getActivity(nextCursor);
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load more activity:', err);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">{t('feed.title')}</h1>

      {items.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-tg-hint">{t('activity.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/groups/${item.groupId}`)}
              className="w-full text-left flex items-start gap-3 p-3 rounded-xl bg-tg-section border border-tg-separator"
            >
              <Avatar avatarKey={item.actorAvatarKey} displayName={item.actorName} size="sm" />
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm line-clamp-2 ${item.type === 'expense_deleted' ? 'text-tg-hint line-through' : ''}`}
                >
                  {getActivityText(item, t, currentUserId, item.currency)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-tg-hint bg-tg-secondary-bg px-2 py-0.5 rounded-full truncate max-w-[40%]">
                    {item.groupName}
                  </span>
                  <span className="text-xs text-tg-hint">{timeAgo(item.createdAt)}</span>
                </div>
              </div>
              {item.type === 'settlement_completed' && (item.metadata as any)?.explorerUrl && (
                <button
                  onClick={(e) => openExternalLink((item.metadata as any).explorerUrl, e)}
                  className="inline-flex items-center gap-0.5 text-xs text-tg-link shrink-0"
                >
                  <IconTon size={12} />
                  TX
                </button>
              )}
              {item.amount != null && item.amount > 0 && (
                <span className="text-sm font-medium text-tg-text shrink-0">
                  {formatAmount(item.amount, item.currency)}
                </span>
              )}
            </button>
          ))}

          {nextCursor && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full py-3 text-sm text-tg-link font-medium"
            >
              {loadingMore ? (
                <div className="w-5 h-5 border-2 border-tg-link/30 border-t-tg-link rounded-full animate-spin mx-auto" />
              ) : (
                t('activity.loadMore')
              )}
            </button>
          )}
        </div>
      )}
    </PageLayout>
  );
}
