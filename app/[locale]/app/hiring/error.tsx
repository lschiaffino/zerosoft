'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error al cargar /app/hiring: qué pasó y cómo reintentar. */
export default function HiringError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common.appSoon');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        product="hiring"
        title={t('errorTitle', { app: 'Hiring' })}
        body={t('errorBody')}
        action={
          <button type="button" className="btn btn-primary" onClick={reset}>
            {t('retry')}
          </button>
        }
      />
    </div>
  );
}
