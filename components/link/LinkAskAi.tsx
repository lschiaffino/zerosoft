'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * "Preguntale a la IA" en las analytics: responde con los números del rango
 * y los filtros que están aplicados en la página.
 */
export default function LinkAskAi({ params }: { params: Record<string, string> }) {
  const t = useTranslations('link');
  const locale = useLocale();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    const res = await fetch('/api/links/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...params, question: q, locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { answer?: string; error?: string } | null;
    setBusy(false);
    if (res?.ok && data?.answer) setAnswer(data.answer);
    else {
      const code = data?.error ?? 'ai_failed';
      setError(t.has(`ai.errors.${code}`) ? t(`ai.errors.${code}`) : t('ai.errors.ai_failed'));
    }
  }

  const suggestions = [t('ai.suggest1'), t('ai.suggest2'), t('ai.suggest3')];

  return (
    <section className="lk-block lk-ai" aria-labelledby="lk-ai-title" data-testid="link-ask-ai">
      <h2 className="lk-h" id="lk-ai-title">
        {t('ai.title')}
      </h2>
      <form className="lk-ai-form" onSubmit={ask}>
        <label className="sr-only" htmlFor="lk-ai-q">
          {t('ai.label')}
        </label>
        <input
          id="lk-ai-q"
          className="input"
          value={question}
          maxLength={500}
          placeholder={t('ai.placeholder')}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!question.trim() || busy} aria-busy={busy || undefined}>
          {busy ? t('ai.asking') : t('ai.ask')}
        </button>
      </form>
      <div className="lk-ai-suggest">
        {suggestions.map((s) => (
          <button key={s} type="button" className="btn btn-ghost btn-sm" onClick={() => setQuestion(s)}>
            {s}
          </button>
        ))}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <p className="lk-ai-answer" role="status" data-testid="link-ai-answer">
          {answer}
        </p>
      )}
    </section>
  );
}
