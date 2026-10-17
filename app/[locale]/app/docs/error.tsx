'use client';

import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';

/** Error al cargar Docs: qué pasó y cómo seguir, sin perder el shell. */
export default function DocsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('docs.state');
  return (
    <div className="docs-landing" role="alert">
      <EmptyState
        product="docs"
        title={t('errorTitle')}
        body={t('errorBody')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            {t('retry')}
          </button>
        }
      />
    </div>
  );
}
