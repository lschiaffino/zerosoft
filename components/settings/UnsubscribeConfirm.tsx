'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * Baja desde el link de un email: abrir la página no cambia nada (los
 * escáneres de links de los correos abren todo); el botón la confirma.
 */
export default function UnsubscribeConfirm({ token, category }: { token: string; category: string | null }) {
  const t = useTranslations('settings.emailPrefs.unsub');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const label = category ? t(`categories.${category}`) : '';
  const go = async () => {
    if (state === 'busy') return;
    setState('busy');
    const res = await fetch('/api/email/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    setState(res?.ok ? 'done' : 'error');
  };
  return (
    <div className="eu-card" data-testid="email-unsubscribe">
      <p className="eu-brand">zerosoft</p>
      <h1 className="eu-title">{t('title')}</h1>
      {state === 'done' ? (
        <p role="status" className="eu-body">
          {category ? t('done', { category: label }) : t('doneAll')}
        </p>
      ) : (
        <>
          <p className="eu-body">{category ? t('body', { category: label }) : t('bodyAll')}</p>
          {state === 'error' && (
            <p className="ui-error" role="alert">
              {t('error')}
            </p>
          )}
          <button type="button" className="btn btn-primary eu-action" disabled={state === 'busy'} onClick={() => void go()}>
            {state === 'busy' ? t('working') : t('confirm')}
          </button>
        </>
      )}
      <Link href="/app/settings/notifications" className="eu-link" prefetch={false}>
        {t('manage')}
      </Link>
    </div>
  );
}
