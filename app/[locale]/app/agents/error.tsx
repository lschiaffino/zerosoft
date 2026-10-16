'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error al cargar la lista o el editor de agentes: qué pasó y cómo reintentar. */
export default function AgentsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('agents');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        product="agents"
        title={t('page.errorTitle')}
        body={t('page.errorBody')}
        action={
          <button type="button" className="btn btn-primary" onClick={reset}>
            {t('page.retry')}
          </button>
        }
      />
    </div>
  );
}
