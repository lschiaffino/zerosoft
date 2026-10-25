'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { aiErrorKey, call } from './api';

/**
 * Borrador con IA del update del proyecto (lo hecho, lo que avanza y lo
 * vencido en las últimas dos semanas), para pegar en el update o en Slack.
 */
export default function ProjectUpdateDraftButton({ projectId }: { projectId: string }) {
  const t = useTranslations('trackTriage.ai');
  const tr = useTranslations('trackTriage');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const run = async () => {
    setOpen(true);
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await call<{ summary: string }>(`/api/track/projects/${projectId}/ai/summary`, { method: 'POST', json: { days: 14 } });
    setBusy(false);
    if (res.ok) setText(res.data.summary);
    else setError(tr(aiErrorKey(res.error, 'ai.summaryError')));
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => void run()} aria-haspopup="dialog" data-testid="track-project-update-draft">
        {t('projectSummary')}
      </button>
      <dialog
        ref={ref}
        className="ui-modal"
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        data-testid="track-project-update-dialog"
      >
        {open && (
          <>
            <div className="ui-modal-head">
              <h2 className="ui-modal-title" id={titleId}>
                {t('projectSummaryTitle')}
              </h2>
            </div>
            <div className="ui-modal-body">
              <p className="ui-help">{t('projectSummaryHelp')}</p>
              {busy && <p className="ui-help">{t('summarizing')}</p>}
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
              {!busy && !error && (
                <textarea
                  className="textarea"
                  rows={9}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={t('projectSummaryTitle')}
                  data-testid="track-project-update-text"
                />
              )}
            </div>
            <div className="ui-modal-foot">
              <span className="ui-foot-note" role="status">
                {copied ? t('copied') : ''}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                {t('close')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy || !text}
                onClick={() => {
                  void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined);
                }}
              >
                {t('copy')}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
