'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';

/** Error de cualquier vista de Voice: qué pasó y cómo reintentar. */
export default function VoiceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('voice.errors');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        title={t('pageTitle')}
        body={t('pageBody')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            {t('retry')}
          </button>
        }
        secondary={<Link href="/app/voice">{t('backToList')}</Link>}
      />
    </div>
  );
}
