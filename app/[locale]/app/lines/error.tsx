'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Si una pantalla de Groups falla al cargar: qué pasó y cómo reintentar, sin perder el shell. */
export default function GroupsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('groups');
  return (
    <EmptyState
      title={t('errors.pageTitle')}
      body={t('errors.pageBody')}
      product="groups"
      action={
        <button type="button" className="btn btn-primary" onClick={reset}>
          {t('common.retry')}
        </button>
      }
    />
  );
}
