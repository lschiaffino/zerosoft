'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const VOTER_KEY = 'zs-help-voter';

/** Id anónimo del navegador: un voto por visitante y artículo (votar de nuevo lo cambia). */
function voterId(): string | undefined {
  try {
    let id = window.localStorage.getItem(VOTER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VOTER_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

/** "¿Te sirvió?" al pie de un artículo del centro de ayuda. */
export default function HelpFeedback({ pageId }: { pageId: string }) {
  const t = useTranslations('docs.help');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function send(helpful: boolean) {
    if (state === 'sending' || state === 'done') return;
    setState('sending');
    try {
      const res = await fetch('/api/docs/help/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, helpful, voter: voterId() }),
      });
      // "Gracias" solo si el voto quedó registrado (no con un 429 o un 404).
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
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
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => send(true)} disabled={state === 'sending'}>
              {t('yes')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => send(false)} disabled={state === 'sending'}>
              {t('no')}
            </button>
          </div>
          {state === 'error' && <p className="ui-error help-feedback-error">{t('feedbackError')}</p>}
        </>
      )}
    </div>
  );
}
