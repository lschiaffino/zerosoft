'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';

/** Error al cargar una pantalla de Cal: qué pasó y cómo seguir, dentro del shell. */
export default function CalendarError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('calendar');
  return (
    <div className="ui-page">
      <EmptyState
        product="cal"
        title={t('errorPage.title')}
        body={t('errorPage.body')}
        action={
          <button type="button" className="btn btn-primary" onClick={reset}>
            {t('errorPage.retry')}
          </button>
        }
        secondary={<Link href="/app/calendar">{t('errorPage.home')}</Link>}
      />
    </div>
  );
}
