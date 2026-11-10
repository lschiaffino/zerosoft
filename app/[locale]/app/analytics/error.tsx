'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';

/** Error de cualquier vista de Analytics: qué pasó y cómo reintentar. */
export default function BiError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('bi.common');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        product="analytics"
        title={t('pageErrorTitle')}
        body={t('pageErrorBody')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            {t('retry')}
          </button>
        }
        secondary={<Link href="/app/analytics">{t('backHome')}</Link>}
      />
    </div>
  );
}
