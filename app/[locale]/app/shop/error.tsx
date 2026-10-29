'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error al cargar /app/shop: qué pasó y cómo reintentar. */
export default function ShopError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common.appSoon');
  return (
    <div className="app-page ui-page" role="alert">
      <EmptyState
        product="shop"
        title={t('errorTitle', { app: 'Shop' })}
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
