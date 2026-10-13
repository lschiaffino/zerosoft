'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** "¿Te sirvió?" al pie de un artículo del centro de ayuda. */
export default function HelpFeedback({ pageId }: { pageId: string }) {
  const t = useTranslations('docs.help');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');

  async function send(helpful: boolean) {
    if (state !== 'idle') return;
    setState('sending');
    try {
      await fetch('/api/docs/help/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, helpful }),
      });
    } finally {
      setState('done');
    }
  }

  return (
    <div className="help-feedback" aria-live="polite">
      {state === 'done' ? (
        <p className="help-feedback-thanks">{t('thanks')}</p>
      ) : (
        <>
          <p className="help-feedback-q">{t('helpful')}</p>
          <div className="help-feedback-actions">
            <button type="button" onClick={() => send(true)} disabled={state !== 'idle'}>
              {t('yes')}
            </button>
            <button type="button" onClick={() => send(false)} disabled={state !== 'idle'}>
              {t('no')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
