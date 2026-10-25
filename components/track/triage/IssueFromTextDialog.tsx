'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { IssueDraft } from '@/lib/track-ai';
import { aiErrorKey, call } from './api';
import { PriorityIcon } from '../glyphs';

/**
 * Issue desde texto libre: se pega un mensaje, un mail o notas, la IA arma
 * título, descripción, prioridad y labels, y la persona lo revisa antes de
 * crear (el issue queda creado por ella, sin pasar por triage).
 */
export default function IssueFromTextDialog({
  open,
  projectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (issueId: string) => void;
}) {
  const t = useTranslations('trackTriage');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<IssueDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) {
      setText('');
      setDraft(null);
      setError(null);
    }
  }, [open]);

  const makeDraft = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    const res = await call<IssueDraft>(`/api/track/projects/${projectId}/ai/issue-from-text`, { method: 'POST', json: { text } });
    setBusy(false);
    if (res.ok) setDraft(res.data);
    else setError(t(aiErrorKey(res.error, 'ai.fromTextError')));
  };

  const create = async () => {
    if (!draft?.title.trim()) return;
    setBusy(true);
    setError(null);
    const res = await call<{ id: string }>(`/api/track/projects/${projectId}/issues`, {
      method: 'POST',
      json: {
        title: draft.title.trim(),
        description: draft.description.trim() ? [{ type: 'text', text: draft.description.trim() }] : [],
        priority: draft.priority,
        labels: draft.labelIds.map((id) => ({ id })),
      },
    });
    setBusy(false);
    if (res.ok) onCreated(res.data.id);
    else setError(t('ai.fromTextError'));
  };

  return (
    <dialog
      ref={ref}
      className="ui-modal ui-modal-wide"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      data-testid="track-from-text-dialog"
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (draft ? create() : makeDraft());
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={titleId}>
              {t('ai.fromTextTitle')}
            </h2>
          </div>
          <div className="ui-modal-body track-from-text">
            {!draft ? (
              <>
                <p className="ui-help">{t('ai.fromTextHelp')}</p>
                <label className="sr-only" htmlFor={`${titleId}-text`}>
                  {t('ai.fromTextTitle')}
                </label>
                <textarea
                  id={`${titleId}-text`}
                  className="textarea"
                  rows={8}
                  autoFocus
                  value={text}
                  maxLength={6000}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('ai.fromTextPlaceholder')}
                  data-testid="track-from-text-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void makeDraft();
                    }
                  }}
                />
              </>
            ) : (
              <div className="track-from-text-draft" data-testid="track-from-text-draft">
                <label className="ui-field">
                  <span className="label">{t('ai.draftTitle')}</span>
                  <input
                    className="input"
                    value={draft.title}
                    maxLength={200}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    data-testid="track-from-text-title"
                    autoFocus
                  />
                </label>
                <div className="ui-field">
                  <span className="label" id={`${titleId}-prio`}>{t('ai.draftPriority')}</span>
                  {/* Prioridad con los íconos de Linear, sin <select>. */}
                  <div className="track-prio-segment" role="radiogroup" aria-labelledby={`${titleId}-prio`}>
                    {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={draft.priority === p}
                        className={`track-qc-chip${draft.priority === p ? '' : ' is-empty'}`}
                        onClick={() => setDraft({ ...draft, priority: p })}
                      >
                        <span className="track-qc-chip-icon" aria-hidden>
                          <PriorityIcon priority={p} />
                        </span>
                        {t(`priorities.${p}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="ui-field">
                  <span className="label">{t('ai.draftDescription')}</span>
                  <textarea
                    className="textarea"
                    rows={6}
                    value={draft.description}
                    maxLength={4000}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>
              </div>
            )}
            {error && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={draft ? () => setDraft(null) : onClose} disabled={busy}>
              {draft ? t('ai.back') : t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || (draft ? !draft.title.trim() : text.trim().length < 3)} aria-busy={busy} data-testid="track-from-text-submit">
              {draft ? t('ai.create') : busy ? t('ai.drafting') : t('ai.draft')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
