'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Si una pantalla de Social falla al cargar: qué pasó y cómo reintentar, sin perder el shell. */
export default function SocialError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('social');
  return (
    <EmptyState
      title={t('errors.pageTitle')}
      body={t('errors.pageBody')}
      product="social"
      action={
        <button type="button" className="btn btn-primary" onClick={reset}>
          {t('errors.retry')}
        </button>
      }
    />
  );
}
