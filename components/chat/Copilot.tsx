'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ChatIcon from './icons';

type Action = 'draft' | 'summarize' | 'rephrase' | 'friendlier' | 'shorter' | 'translate';

const NEEDS_TEXT: Action[] = ['rephrase', 'friendlier', 'shorter', 'translate'];

/**
 * AI del agente en el compositor (el Copilot de Intercom): redactar con el
 * centro de ayuda, resumir el hilo como nota interna y reescribir lo escrito.
 * Nada se manda solo: el texto vuelve al compositor (con "deshacer") y el
 * resumen se agrega como nota solo si el agente lo confirma.
 */
export default function Copilot({
  conversationId,
  text,
  onText,
  onNote,
}: {
  conversationId: string;
  /** Lo escrito en el compositor. */
  text: string;
  onText: (text: string) => void;
  onNote: (text: string) => Promise<boolean>;
}) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [undo, setUndo] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function run(action: Action) {
    if (busy) return;
    if (NEEDS_TEXT.includes(action) && !text.trim()) {
      setError(t('copilot.writeFirst'));
      return;
    }
    setBusy(action);
    setError(null);
    setOpen(false);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, text, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; sources?: string[]; error?: string };
      if (!res.ok || !data.text) {
        setError(
          data.error === 'ai_disabled'
            ? t('copilot.disabled')
            : data.error === 'quota_exceeded'
              ? t('copilot.quota')
              : data.error === 'rate_limited'
                ? t('copilot.rateLimited')
                : data.error === 'no_messages'
                  ? t('copilot.noMessages')
                  : t('copilot.failed'),
        );
        return;
      }
      if (action === 'summarize') {
        setSummary(data.text);
        return;
      }
      setUndo(text);
      setSources(data.sources ?? []);
      onText(data.text);
    } catch {
      setError(t('copilot.failed'));
    } finally {
      setBusy(null);
    }
  }

  const items: Array<{ action: Action; label: string }> = [
    { action: 'draft', label: t('copilot.draft') },
    { action: 'summarize', label: t('copilot.summarize') },
    { action: 'rephrase', label: t('copilot.rephrase') },
    { action: 'friendlier', label: t('copilot.friendlier') },
    { action: 'shorter', label: t('copilot.shorter') },
    { action: 'translate', label: t('copilot.translate') },
  ];

  return (
    <div className="chat-copilot" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-busy={busy ? true : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <ChatIcon name="spark" size={14} />
        {busy ? t('copilot.working') : t('copilot.label')}
      </button>
      {open && (
        <ul className="chat-copilot-menu" role="menu" aria-label={t('copilot.label')}>
          {items.map((i) => (
            <li key={i.action} role="none">
              <button type="button" role="menuitem" onClick={() => void run(i.action)} disabled={NEEDS_TEXT.includes(i.action) && !text.trim()}>
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="ui-error chat-copilot-note" role="alert">
          {error}
        </p>
      )}
      {undo !== null && !busy && (
        <p className="ui-help chat-copilot-note" role="status">
          {sources.length > 0 ? t('copilot.usedSources', { sources: sources.join(', ') }) : t('copilot.replaced')}{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onText(undo);
              setUndo(null);
              setSources([]);
            }}
          >
            {t('copilot.undo')}
          </button>
        </p>
      )}
      {summary && (
        <div className="chat-copilot-summary" role="region" aria-label={t('copilot.summaryTitle')}>
          <p className="chat-copilot-summary-title">{t('copilot.summaryTitle')}</p>
          <p className="chat-copilot-summary-text">{summary}</p>
          <div className="chat-copilot-summary-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSummary(null)}>
              {t('copilot.discard')}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                if (await onNote(summary)) setSummary(null);
                else setError(t('copilot.failed'));
              }}
            >
              {t('copilot.addNote')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
