'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import NotesIcon from './NotesIcon';

interface Answer {
  answer: string | null;
  sources: Array<{ id: string; title: string }>;
  error?: string;
}

/**
 * "Preguntale a tus notas": drawer nativo (<dialog class="ui-drawer">) con la
 * respuesta de la AI y las notas citadas. Esc y el foco atrapado vienen del dialog.
 */
export default function NotesAskPanel({
  onClose,
  onOpenNote,
}: {
  onClose: () => void;
  onOpenNote: (id: string) => void;
}) {
  const t = useTranslations('notes.ask');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    inputRef.current?.focus();
    return () => d?.close();
  }, []);

  async function ask() {
    const q = question.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/notes/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json().catch(() => ({ error: 'ai_failed' }))) as Answer;
      setResult({ answer: data.answer ?? null, sources: data.sources ?? [], error: data.error });
    } catch {
      setResult({ answer: null, sources: [], error: 'ai_failed' });
    } finally {
      setBusy(false);
    }
  }

  const errorText = (code: string) => {
    switch (code) {
      case 'no_matches':
        return t('noMatches');
      case 'rate_limited':
      case 'quota_exceeded':
        return t('limited');
      case 'ai_disabled':
        return t('disabled');
      default:
        return t('failed');
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="ui-drawer notes-ask"
      aria-labelledby="notes-ask-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clic en el telón (fuera del panel) cierra.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-drawer-head">
        <h2 id="notes-ask-title" className="ui-drawer-title">
          {t('title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={t('close')}>
          <NotesIcon name="close" size={16} />
        </button>
      </div>
      <form
        className="ui-drawer-body notes-ask-body"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <p className="ui-help">{t('hint')}</p>
        <textarea
          ref={inputRef}
          className="textarea"
          rows={3}
          maxLength={500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('title')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <button type="submit" className="btn btn-primary notes-ask-submit" aria-busy={busy} disabled={question.trim().length < 2}>
          {busy ? t('thinking') : t('submit')}
        </button>
        {busy && (
          <div className="ui-loading-stack" aria-hidden="true">
            <span className="ui-skeleton ui-skeleton-text" />
            <span className="ui-skeleton ui-skeleton-text" style={{ width: '80%' }} />
            <span className="ui-skeleton ui-skeleton-text" style={{ width: '45%' }} />
          </div>
        )}
        {result && (
          <div className="notes-ask-result" aria-live="polite">
            {result.answer ? (
              <p className="notes-ask-answer">{result.answer}</p>
            ) : (
              <p className={result.error === 'no_matches' ? 'ui-help' : 'ui-error'}>{errorText(result.error ?? 'ai_failed')}</p>
            )}
            {result.sources.length > 0 && (
              <>
                <h3 className="notes-ask-sources-label">{t('sources')}</h3>
                <ul className="notes-ask-sources">
                  {result.sources.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="notes-ask-source" onClick={() => onOpenNote(s.id)}>
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </form>
    </dialog>
  );
}
