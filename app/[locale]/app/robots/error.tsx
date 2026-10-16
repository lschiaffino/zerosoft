'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';

/** Error de cualquier vista de Robots: qué pasó y cómo reintentar. */
export default function RobotsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('robots');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        title={t('errors.pageTitle')}
        body={t('errors.pageBody')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            {t('errors.retry')}
          </button>
        }
        secondary={<Link href="/app/robots">{t('errors.backToList')}</Link>}
      />
    </div>
  );
}
