'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import { FLEET_NAME } from '@/lib/fleet/name';

/** Error al cargar /app/fleet: qué pasó y cómo reintentar. */
export default function FleetError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common.appSoon');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        product="fleet"
        title={t('errorTitle', { app: FLEET_NAME })}
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
