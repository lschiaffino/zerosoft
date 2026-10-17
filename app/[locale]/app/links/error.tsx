'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error de cualquier pantalla de Link: qué pasó y cómo seguir, sin perder el shell. */
export default function LinksError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('link.states');
  return (
    <div className="ui-page" role="alert">
      <EmptyState
        title={t('errorTitle')}
        body={t('errorBody')}
        product="link"
        action={
          <button type="button" className="btn btn-primary" onClick={reset}>
            {t('retry')}
          </button>
        }
      />
    </div>
  );
}
