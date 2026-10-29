'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import AssistantChat, { type PageInfo } from './AssistantChat';
import { ASSISTANT_EVENT, type OpenAssistantDetail } from './client';
import { useAssistantStatus, useSuggestions } from './useAssistantStatus';

const STORE_KEY = 'zs:assistant-panel-conversation';

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(STORE_KEY, id);
    else window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Sin storage: la charla vive mientras dure la pestaña.
  }
}

/**
 * Panel lateral del asistente, en toda /app. Se abre con ⌘J (Ctrl+J), con el
 * botón de la banda o con el evento 'zs:assistant'; Esc lo cierra. Al abrir
 * toma la página actual y el texto seleccionado como contexto. En el
 * teléfono ocupa toda la pantalla.
 */
export default function AssistantPanel() {
  const t = useTranslations('assistant');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  /** Cambia al empezar otra charla (nueva, abierta desde afuera): remonta la vista. No cambia cuando el turno crea la charla. */
  const [chatKey, setChatKey] = useState(0);
  const { status, error } = useAssistantStatus(open);
  const suggestions = useSuggestions(pathname);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onPage = pathname.startsWith('/app/assistant');

  useEffect(() => {
    setConversationId(readStored());
  }, []);

  const capture = useCallback(() => {
    const selection = window.getSelection?.()?.toString().trim().slice(0, 1500) || undefined;
    setPage({ path: pathname.slice(0, 300), title: document.title.slice(0, 120), selection });
  }, [pathname]);

  const show = useCallback(
    (detail?: OpenAssistantDetail) => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      capture();
      if (detail?.conversationId) {
        setConversationId(detail.conversationId);
        writeStored(detail.conversationId);
        setPrompt(null);
        setChatKey((k) => k + 1);
      }
      if (detail?.prompt) {
        setConversationId(null);
        writeStored(null);
        setPrompt(detail.prompt);
        setChatKey((k) => k + 1);
      }
      setOpen(true);
    },
    [capture],
  );

  const close = useCallback(() => {
    setOpen(false);
    const prev = returnFocus.current;
    const back = prev && prev.isConnected && prev !== document.body && !prev.closest('.asst-panel') ? prev : document.querySelector<HTMLElement>('[data-assistant-trigger]');
    window.setTimeout(() => back?.focus(), 0);
  }, []);

  // ⌘J / Ctrl+J alterna el panel; el evento lo abre (botón de la banda, ⌘K, inicio).
  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<OpenAssistantDetail | undefined>).detail);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener(ASSISTANT_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(ASSISTANT_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, show, close]);

  // Esc cierra (salvo que un modal abierto lo use antes, como ⌘K o una confirmación).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (open && status?.state === 'ready') window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open, status]);

  // La página del asistente ya tiene su charla: el panel no se abre encima.
  useEffect(() => {
    if (onPage && open) setOpen(false);
  }, [onPage, open]);

  const onConversation = useCallback((id: string) => {
    setConversationId(id);
    writeStored(id);
  }, []);

  if (!open) return null;
  return (
    <div className="asst-panel" role="dialog" aria-label={t('title')} ref={panelRef} data-testid="assistant-panel">
      <div className="asst-panel-head">
        <h2 className="asst-panel-title">{t('title')}</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setConversationId(null);
            writeStored(null);
            setPrompt(null);
            setChatKey((k) => k + 1);
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          {t('newChat')}
        </button>
        <Link href={conversationId ? `/app/assistant?c=${conversationId}` : '/app/assistant'} className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          {t('history')}
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={close} aria-label={t('close')} title={`${t('close')} (Esc)`}>
          {t('close')}
        </button>
      </div>
      <AssistantChat
        key={chatKey}
        conversationId={conversationId}
        onConversation={onConversation}
        status={status}
        statusError={error}
        page={page}
        suggestions={suggestions}
        initialPrompt={prompt}
        compact
        inputRef={inputRef}
      />
    </div>
  );
}
