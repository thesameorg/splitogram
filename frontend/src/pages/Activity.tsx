import { useTranslation } from 'react-i18next';
import { PageLayout } from '../components/PageLayout';

export function Activity() {
  const { t } = useTranslation();

  return (
    <PageLayout>
      <h1 className="text-xl font-bold mb-6">{t('activity.title')}</h1>
      <div className="text-center py-12">
        <p className="text-tg-hint">{t('activity.comingSoon')}</p>
      </div>
    </PageLayout>
  );
}
