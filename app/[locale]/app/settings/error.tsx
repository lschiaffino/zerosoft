'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error de cualquier pestaña de Ajustes: qué pasó y cómo seguir, sin perder las pestañas. */
export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('settings.states');
  return (
    <div role="alert">
      <EmptyState
        title={t('errorTitle')}
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
