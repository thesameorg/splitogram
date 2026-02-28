import { useTranslation } from 'react-i18next';

export function LoadingScreen() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-tg-hint">{t('loading')}</div>
    </div>
  );
}
