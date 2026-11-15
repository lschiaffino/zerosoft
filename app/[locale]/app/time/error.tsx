'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error al cargar /app/time: qué pasó y cómo reintentar. */
export default function TimeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common.appSoon');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        product="time"
        title={t('errorTitle', { app: 'Time' })}
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
