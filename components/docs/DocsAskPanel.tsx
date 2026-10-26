'use client';

import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import Icon from '@/components/app/icons';
import { markdownToBlocks } from '@/lib/docs-import';
import { sanitizeHtml as sanitizeRichHtml } from '@/lib/docs-richtext';
import DocsBlocksView from './DocsBlocksView';
import DocsGlyph from './DocsGlyphs';

export const DOCS_ASK_EVENT = 'zs:docs-ask';

interface Citation {
  n: number;
  pageId: string;
  title: string;
  url: string;
  snippet: string;
}

interface Turn {
  question: string;
  answer: string | null;
  citations: Citation[];
  error: string | null;
}

/** [1], [2][3] → links a la fuente (dentro del Markdown, como superíndices). */
function withCitationLinks(md: string, citations: Citation[]): string {
  const byN = new Map(citations.map((c) => [c.n, c]));
  return md.replace(/\[(\d{1,2})\](?!\()/g, (m, n: string) => {
    const c = byN.get(Number(n));
    return c ? `[[${n}]](${c.url})` : m;
  });
}

/**
 * "Ask AI" de Docs (como el Q&A de Notion AI): preguntas sobre todas las
 * páginas que la persona puede abrir, con la respuesta citando cada página
 * ([1], [2]) y la lista de fuentes abajo. Se abre desde la banda, el
 * sidebar (?ask=1) o ⌘K. Esc cierra.
 */
export default function DocsAskPanel() {
  const t = useTranslations('docs.ask');
  const uid = useId();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    prevFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  useEffect(() => {
    if (params.get('ask') === '1') show();
  }, [params, show]);
  useEffect(() => {
    window.addEventListener(DOCS_ASK_EVENT, show);
    return () => window.removeEventListener(DOCS_ASK_EVENT, show);
  }, [show]);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const close = () => {
    setOpen(false);
    prevFocus.current?.focus?.();
  };

  const ask = async () => {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setBusy(true);
    setQ('');
    setTurns((prev) => [...prev, { question, answer: null, citations: [], error: null }]);
    let turn: Turn = { question, answer: null, citations: [], error: null };
    try {
      const res = await fetch('/api/docs/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      const data = (await res.json().catch(() => ({}))) as { answer?: string | null; citations?: Citation[]; error?: string };
      if (!res.ok || data.error) turn = { ...turn, error: data.error ?? 'ai_error' };
      else turn = { ...turn, answer: data.answer ?? '', citations: data.citations ?? [] };
    } catch {
      turn = { ...turn, error: 'network' };
    }
    setTurns((prev) => [...prev.slice(0, -1), turn]);
    setBusy(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!open) return null;
  const errorText = (code: string) => (['ai_disabled', 'quota_exceeded', 'rate_limited', 'no_matches', 'network'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));

  return (
    <aside
      ref={panelRef}
      className="docs-ask-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${uid}-title`}
      data-testid="docs-ask-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="docs-ask-head">
        <h2 id={`${uid}-title`} className="docs-ask-title">
          <DocsGlyph name="sparkle" size={15} />
          {t('title')}
        </h2>
        {turns.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTurns([])}>
            {t('clear')}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={close} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="docs-ask-body" aria-live="polite">
        {turns.length === 0 && (
          <div className="docs-ask-empty">
            <p>{t('emptyTitle')}</p>
            <p className="ui-help">{t('emptyBody')}</p>
          </div>
        )}
        {turns.map((turn, i) => (
          <Fragment key={i}>
            <p className="docs-ask-q">{turn.question}</p>
            {turn.answer === null && !turn.error && (
              <p className="ui-help docs-ask-loading" role="status">
                {t('thinking')}
              </p>
            )}
            {turn.error && (
              <p className={turn.error === 'no_matches' ? 'ui-help' : 'ui-error'} role="alert" data-testid="docs-ask-error">
                {errorText(turn.error)}
              </p>
            )}
            {turn.answer !== null && !turn.error && (
              <div className="docs-ask-a" data-testid="docs-ask-answer">
                <DocsBlocksView blocks={markdownToBlocks(withCitationLinks(turn.answer, turn.citations), { sanitize: sanitizeRichHtml })} boards={false} />
                {turn.citations.length > 0 && (
                  <ol className="docs-ask-sources" aria-label={t('sources')}>
                    {turn.citations.map((c) => (
                      <li key={c.n} value={c.n}>
                        <Link href={c.url} className="docs-ask-source" onClick={close}>
                          <span className="docs-ask-source-title">{c.title || t('untitled')}</span>
                          <span className="docs-ask-source-snippet">{c.snippet}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <form
        className="docs-ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label htmlFor={`${uid}-q`} className="sr-only">
          {t('placeholder')}
        </label>
        <textarea
          id={`${uid}-q`}
          ref={inputRef}
          className="textarea docs-ask-input"
          rows={2}
          value={q}
          maxLength={1000}
          placeholder={t('placeholder')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || q.trim().length < 2}>
          {t('ask')}
        </button>
      </form>
      <p className="docs-ai-note">{t('note')}</p>
    </aside>
  );
}
