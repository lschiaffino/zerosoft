'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../api';

/**
 * Pestaña Notas del panel de un chat de WhatsApp en Inbox: las notas propias del chat (solo las ve quien es dueño
 * de la bandeja; la IA las usa de contexto). Es el mismo campo que abría el botón Notas del encabezado, que ahora
 * abre esta pestaña.
 */
export default function ThreadNotes({ threadId }: { threadId: string }) {
  const t = useTranslations('inbox');
  const td = useTranslations('groups.wa.details');
  const [notes, setNotes] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void api<{ notes: string }>(`/api/inbox/threads/${threadId}`).then((r) => {
      if (!live) return;
      if (r.ok) setNotes(String(r.data.notes ?? ''));
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [threadId, retry]);

  const save = async () => {
    if (notes === null) return;
    setState('saving');
    const r = await api(`/api/inbox/threads/${threadId}`, { method: 'PATCH', json: { notes } });
    setState(r.ok ? 'saved' : 'error');
  };

  return (
    <section className="ib-wa-card ib-notes ib-wa-notes" data-testid="details-thread-notes">
      <label className="label" htmlFor={`ib-notes-text-${threadId}`}>
        {t('notes.label')}
      </label>
      <p className="ib-help">{t('notes.help')}</p>
      {failed ? (
        <p className="ib-help" role="alert">
          {td('loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry((n) => n + 1)}>
            {td('retry')}
          </button>
        </p>
      ) : notes === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : (
        <>
          <textarea
            id={`ib-notes-text-${threadId}`}
            className="textarea"
            rows={6}
            value={notes}
            maxLength={20000}
            onChange={(e) => {
              setNotes(e.target.value);
              setState('');
            }}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter guarda, como en el resto de los campos largos.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
          />
          <div className="ib-row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={state === 'saving'} onClick={() => void save()}>
              {state === 'saving' ? t('notes.saving') : t('notes.save')}
            </button>
            {state === 'saved' && <span className="ib-dim">{t('notes.saved')}</span>}
            {state === 'error' && (
              <span className="ib-error" role="alert">
                {td('saveError')}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
