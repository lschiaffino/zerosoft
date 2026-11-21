'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Close, Search } from './icons';
import { listTime } from './format';

/**
 * Buscar mensajes en el chat abierto (Lines e Inbox), como la lupa de la
 * cabecera de WhatsApp Web: un panel a la derecha de la conversación (en el
 * teléfono la tapa) con el campo de búsqueda y los resultados del más nuevo al
 * más viejo, con la fecha, quién lo escribió y el texto con lo encontrado
 * marcado. Un clic lleva al mensaje en la conversación. Esc o la X lo cierran.
 * Cada app pone cómo se busca (`search`) y cómo se va al mensaje (`onPick`).
 */

export interface ChatSearchHitView {
  id: string;
  sentAt: string;
  fromMe: boolean;
  senderName: string;
  note?: boolean;
  /** Texto con lo encontrado entre \u0002 y \u0003. */
  snippet: string;
}

export type ChatSearchFn = (q: string, before?: string) => Promise<{ hits: ChatSearchHitView[]; more: boolean } | null>;

const HIT_RE = /(\u0002[^\u0003]*\u0003)/;

function Snippet({ text }: { text: string }) {
  const parts = text.split(HIT_RE).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

/** Cmd/Ctrl+Shift+F abre la búsqueda del chat (como WhatsApp Web). */
export function useChatSearchShortcut(onOpen: () => void) {
  const cb = useRef(onOpen);
  cb.current = onOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      cb.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function ChatSearchPanel(props: {
  /** Cambia con el chat: la búsqueda empieza de cero. */
  chatKey: string;
  chatName: string;
  group: boolean;
  search: ChatSearchFn;
  /** `covering`: el panel tapa la conversación (teléfono): conviene cerrarlo para ver el mensaje. */
  onPick: (hit: ChatSearchHitView, covering: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations('groups.wa.chatSearch');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ChatSearchHitView[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [loadingMore, setLoadingMore] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const pick = (h: ChatSearchHitView) => {
    setPicked(h.id);
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    props.onPick(h, !!panel && !!parent && panel.offsetWidth >= parent.clientWidth * 0.9);
  };
  const seq = useRef(0);
  const { search, onClose } = props;

  useEffect(() => {
    setQ('');
    setHits([]);
    setMore(false);
    setState('idle');
    setPicked(null);
    inputRef.current?.focus();
  }, [props.chatKey]);

  const run = useCallback(
    async (term: string) => {
      const n = ++seq.current;
      if (!term.trim()) {
        setHits([]);
        setMore(false);
        setState('idle');
        return;
      }
      setState('loading');
      const r = await search(term.trim());
      if (n !== seq.current) return;
      if (!r) {
        setState('error');
        return;
      }
      setHits(r.hits);
      setMore(r.more);
      setPicked(null);
      setState('done');
    },
    [search],
  );

  // Esc lo cierra desde cualquier lugar de la conversación (antes que cerrar el chat), salvo con un menú o un diálogo abierto.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open], [role="menu"], [role="listbox"], .wa-viewer')) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void run(q), 250);
    return () => window.clearTimeout(id);
  }, [q, run]);

  async function loadMore() {
    const last = hits[hits.length - 1];
    if (!last || loadingMore) return;
    const n = seq.current;
    setLoadingMore(true);
    const r = await search(q.trim(), last.sentAt);
    setLoadingMore(false);
    if (n !== seq.current || !r) return;
    setHits((h) => [...h, ...r.hits.filter((x) => !h.some((y) => y.id === x.id))]);
    setMore(r.more);
  }

  return (
    <aside
      ref={panelRef}
      className="wa-chat-search"
      aria-label={t('title')}
      data-testid="chat-search"
      // Sin el micrófono flotante de dictado: caía encima del conteo de resultados (y en el teléfono lo tapaba).
      data-voice-off
    >
      <div className="wa-chat-search-head">
        <button type="button" className="wa-icon-btn" onClick={onClose} aria-label={t('close')} title={t('close')} data-testid="chat-search-close">
          <Close size={20} />
        </button>
        <h3>{t('title')}</h3>
      </div>
      <div className="wa-chat-search-field">
        <label className="wa-search">
          <Search size={18} />
          <input
            ref={inputRef}
            type="search"
            className="gr-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) {
                e.preventDefault();
                pick(hits[0]);
              }
            }}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            autoFocus
            data-testid="chat-search-input"
          />
        </label>
      </div>
      <div className="wa-chat-search-body" aria-busy={state === 'loading' || undefined}>
        {state === 'idle' && <p className="wa-chat-search-note">{t('hint', { name: props.chatName })}</p>}
        {state === 'loading' && hits.length === 0 && <p className="wa-chat-search-note">{t('searching')}</p>}
        {state === 'error' && (
          <p className="wa-chat-search-note" role="alert">
            {t('error')}{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(q)}>
              {t('retry')}
            </button>
          </p>
        )}
        {state === 'done' && hits.length === 0 && (
          <p className="wa-chat-search-note" role="status">
            {t('none')}
          </p>
        )}
        {hits.length > 0 && state !== 'error' && (
          <>
            <p className="wa-chat-search-count" role="status">
              {more ? t('countMore', { n: hits.length }) : t('count', { n: hits.length })}
            </p>
            <ul className="wa-chat-search-list" data-testid="chat-search-results">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className={`wa-chat-search-hit${picked === h.id ? ' is-on' : ''}`}
                    onClick={() => pick(h)}
                    data-testid="chat-search-hit"
                    data-message-id={h.id}
                  >
                    <span className="wa-chat-search-when">{listTime(h.sentAt, locale)}</span>
                    <span className="wa-chat-search-text">
                      {h.note ? <span className="wa-chat-search-who">{t('note')}: </span> : h.fromMe ? <span className="wa-chat-search-who">{t('you')}: </span> : props.group && h.senderName ? <span className="wa-chat-search-who">{h.senderName}: </span> : null}
                      <Snippet text={h.snippet} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {more && (
              <p className="wa-chat-search-more">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadMore()} aria-busy={loadingMore || undefined} data-testid="chat-search-more">
                  {t('more')}
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
