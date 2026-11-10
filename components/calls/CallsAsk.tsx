'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { api, useDate, useErrorText } from './ui';

interface Answer {
  q: string;
  answer: string;
  sources: Array<{ id: string; title: string; at: string }>;
}

/** Preguntas sobre todas las llamadas que la persona ve, con las llamadas citadas. */
export default function CallsAsk({ hasCalls }: { hasCalls: boolean }) {
  const t = useTranslations('calls.ask');
  const locale = useLocale();
  const date = useDate();
  const err = useErrorText();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Answer[]>([]);

  const ask = async (question: string) => {
    if (busy || question.trim().length < 2) return;
    setBusy(true);
    setError(null);
    const res = await api<{ answer?: string; sources?: Answer['sources'] }>('/api/calls/ask', { method: 'POST', json: { question: question.trim(), locale } });
    setBusy(false);
    if (!res.ok) return setError(err(res.data.error));
    setItems([{ q: question.trim(), answer: res.data.answer ?? '', sources: res.data.sources ?? [] }, ...items]);
    setQ('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(q);
  };

  return (
    <div className="app-page ui-page cl-page cl-narrow">
      <PageHeader title={t('title')} description={t('desc')} />
      <form onSubmit={submit} className="cl-form cl-ask-form">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder={t('placeholder')} aria-label={t('placeholder')} disabled={!hasCalls} data-testid="calls-ask-all-input" />
        <button type="submit" className="btn btn-primary" disabled={busy || q.trim().length < 2 || !hasCalls} data-testid="calls-ask-all-submit">
          {busy ? t('asking') : t('submit')}
        </button>
      </form>
      {!hasCalls && <p className="cl-muted">{t('noCalls')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {hasCalls && items.length === 0 && (
        <div className="cl-examples">
          <p className="cl-muted">{t('examplesTitle')}</p>
          <ul>
            {(['a', 'b', 'c'] as const).map((k) => (
              <li key={k}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void ask(t(`examples.${k}`))}>
                  {t(`examples.${k}`)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {items.map((x, i) => (
        <section key={i} className="cl-answer" data-testid="calls-ask-all-answer">
          <p className="cl-question">{x.q}</p>
          {x.sources.length === 0 ? (
            <p className="cl-muted">{t('noMatches')}</p>
          ) : (
            <>
              <p className="cl-prose">{x.answer}</p>
              <h3 className="cl-h3">{t('sources')}</h3>
              <ol className="cl-sources">
                {x.sources.map((s) => (
                  <li key={s.id}>
                    <Link href={`/app/calls/call/${s.id}`}>{s.title}</Link> <span className="cl-muted">{date(s.at, false)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
