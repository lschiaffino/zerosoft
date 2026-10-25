'use client';

import { useTranslations } from 'next-intl';

export default function TalkError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('talk');
  return (
    <div className="ui-empty" role="alert">
      <p className="ui-empty-title">{t('errors.page')}</p>
      <p className="ui-empty-body">{t('errors.pageBody')}</p>
      <div className="ui-empty-actions">
        <button type="button" className="btn btn-sm" onClick={reset}>
          {t('common.retry')}
        </button>
      </div>
    </div>
  );
}
