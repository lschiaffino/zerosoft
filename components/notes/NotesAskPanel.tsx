'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Answer {
  answer: string | null;
  sources: Array<{ id: string; title: string }>;
  error?: string;
}

/** "Preguntale a tus notas": respuesta de la AI con las notas citadas. */
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    <div className="notes-ask" role="dialog" aria-label={t('title')}>
      <div className="notes-ask-head">
        <p>{t('title')}</p>
        <button type="button" className="notes-icon-btn" onClick={onClose} aria-label={t('close')}>
          ×
        </button>
      </div>
      <p className="notes-ask-hint">{t('hint')}</p>
      <textarea
        ref={inputRef}
        className="notes-ask-input"
        rows={3}
        maxLength={500}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={t('placeholder')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void ask();
          }
        }}
      />
      <button type="button" className="btn btn-solid btn-small" disabled={busy || question.trim().length < 2} onClick={() => void ask()}>
        {busy ? t('thinking') : t('submit')}
      </button>
      {result && (
        <div className="notes-ask-result" aria-live="polite">
          {result.answer ? <p className="notes-ask-answer">{result.answer}</p> : <p className="dim">{errorText(result.error ?? 'ai_failed')}</p>}
          {result.sources.length > 0 && (
            <>
              <p className="notes-ask-sources-label">{t('sources')}</p>
              <ul className="notes-ask-sources">
                {result.sources.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="notes-link-btn" onClick={() => onOpenNote(s.id)}>
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
