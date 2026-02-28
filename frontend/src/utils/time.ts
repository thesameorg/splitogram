import i18n from '../i18n';

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return i18n.t('time.justNow');
  if (mins < 60) return i18n.t('time.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return i18n.t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return i18n.t('time.daysAgo', { count: days });
}
