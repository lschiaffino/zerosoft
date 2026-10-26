'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error al cargar /app/voice: qué pasó y cómo reintentar. */
export default function VoiceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common.appSoon');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        product="voice"
        title={t('errorTitle', { app: 'Voice' })}
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
