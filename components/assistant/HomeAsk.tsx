'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { ConversationSummary } from './client';
import { useAssistantStatus, useSuggestions } from './useAssistantStatus';

/**
 * El asistente en el inicio de la plataforma: preguntar abre la charla a
 * página completa (/app/assistant?q=…), con las charlas recientes debajo.
 */
export default function HomeAsk() {
  const t = useTranslations('assistant');
  const router = useRouter();
  const suggestions = useSuggestions('/app');
  const [draft, setDraft] = useState('');
  const [recent, setRecent] = useState<ConversationSummary[]>([]);
  const { status } = useAssistantStatus(true);
  const ready = status?.state === 'ready';

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void fetch('/api/assistant/conversations')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { conversations?: ConversationSummary[] } | null) => {
        if (alive && d?.conversations) setRecent(d.conversations.slice(0, 4));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ready]);

  function ask(text: string) {
    const q = text.trim();
    if (!q) return;
    router.push(`/app/assistant?q=${encodeURIComponent(q)}`);
  }

  // Mientras carga o si no responde el estado: nada (el inicio no salta con un error ajeno).
  if (!status) return null;
  if (!ready) {
    return (
      <section className="asst-home" aria-labelledby="asst-home-title" data-testid="home-assistant-off">
        <h2 id="asst-home-title" className="asst-home-title">
          {status.state === 'disabled' ? t('notConfigured.disabledTitle') : t('notConfigured.title')}
        </h2>
        <p className="muted">{status.admin ? t('notConfigured.admin') : t('notConfigured.member')}</p>
      </section>
    );
  }

  return (
    <section className="asst-home" aria-labelledby="asst-home-title" data-testid="home-assistant">
      <h2 id="asst-home-title" className="asst-home-title">
        {t('home.title')}
      </h2>
      <form
        className="asst-home-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <label className="sr-only" htmlFor="asst-home-input">
          {t('home.placeholder')}
        </label>
        <textarea
          id="asst-home-input"
          className="textarea"
          rows={2}
          maxLength={4000}
          value={draft}
          placeholder={t('home.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(draft);
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
          {t('home.ask')}
        </button>
      </form>
      <ul className="asst-home-suggestions" aria-label={t('empty.suggestions')}>
        {suggestions.map((s) => (
          <li key={s}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ask(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
      <div className="asst-home-foot">
        {recent.length > 0 && (
          <ul className="asst-home-recent" aria-label={t('home.recent')}>
            {recent.map((c) => (
              <li key={c.id}>
                <Link href={`/app/assistant?c=${c.id}`}>{c.title || t('page.untitled')}</Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/app/assistant">{t('home.viewAll')}</Link>
        <p className="muted">{t('home.shortcut', { key: '⌘J' })}</p>
      </div>
    </section>
  );
}
