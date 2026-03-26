import { useTranslation } from 'react-i18next';
import { config } from '../../config';
import { openExternalLink } from '../../utils/links';

const ExternalLinkIcon = () => (
  <svg
    className="w-4 h-4 text-tg-hint"
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
);

interface LinksSectionProps {
  isAdmin: boolean;
  onOpenFeedback: () => void;
}

export function LinksSection({ isAdmin, onOpenFeedback }: LinksSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Channel */}
      <div className="mb-4">
        <button
          onClick={() => window.Telegram?.WebApp?.openTelegramLink('https://t.me/splitogramm')}
          className="w-full flex justify-between items-center p-3 card rounded-2xl text-left"
        >
          <span className="font-medium">{t('account.channel')}</span>
          <ExternalLinkIcon />
        </button>
      </div>

      {/* Legal */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 text-tg-hint">{t('account.legal')}</label>
        <div className="card rounded-2xl space-y-2">
          <button
            onClick={() => openExternalLink(`${config.apiBaseUrl}/terms`)}
            className="w-full flex justify-between items-center p-3 text-left"
          >
            <span className="font-medium">{t('account.termsOfService')}</span>
            <ExternalLinkIcon />
          </button>
          <button
            onClick={() => openExternalLink(`${config.apiBaseUrl}/privacy`)}
            className="w-full flex justify-between items-center p-3 text-left"
          >
            <span className="font-medium">{t('account.privacyPolicy')}</span>
            <ExternalLinkIcon />
          </button>
        </div>
      </div>

      {/* Feedback */}
      <div className="mb-4">
        <button
          onClick={onOpenFeedback}
          className="w-full p-3 card rounded-2xl text-left font-medium"
        >
          {t('account.feedback')}
        </button>
      </div>

      {/* Admin Dashboard Link */}
      {isAdmin && (
        <div className="mb-4">
          <button
            onClick={() => {
              const base = config.apiBaseUrl || window.location.origin;
              const url = `${base}/admin`;
              window.Telegram?.WebApp?.openLink?.(url) ?? window.open(url, '_blank');
            }}
            className="w-full p-3 card rounded-2xl text-left font-medium"
          >
            Admin Dashboard
          </button>
        </div>
      )}
    </>
  );
}
