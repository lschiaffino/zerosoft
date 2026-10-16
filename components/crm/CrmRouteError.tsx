'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/**
 * Error de una vista del CRM (error.tsx): dice qué pasó y deja reintentar
 * sin perder la navegación ni el resto del shell.
 */
export default function CrmRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('crm.record.error');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="ui-page" role="alert">
      <EmptyState
        title={t('title')}
        body={t('body')}
        action={
          <button type="button" className="btn btn-primary" onClick={reset}>
            {t('retry')}
          </button>
        }
        secondary={error.digest ? <span className="data">{error.digest}</span> : undefined}
      />
    </div>
  );
}
