'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import AssistantChat, { type PageInfo } from './AssistantChat';
import { ASSISTANT_EVENT, type OpenAssistantDetail } from './client';
import { useAssistantStatus, useSuggestions } from './useAssistantStatus';
import { focusReturnTarget, useLayer } from '@/lib/ui/layers';
import PanelSplitter from '@/components/ui/PanelSplitter';

const STORE_KEY = 'zs:assistant-panel-conversation';
/** Cómo se ve el panel (flotante, fijo al costado o a pantalla completa) y su ancho: por navegador. */
const LAYOUT_KEY = 'zs:assistant-panel-layout';
export type PanelMode = 'float' | 'pinned' | 'full';
const WIDTH_DEFAULT = 440;
const WIDTH_MIN = 340;
/** Lo que queda de la página al lado del panel fijo (o flotante) como mínimo. */
const PAGE_MIN = 360;

function maxWidth(): number {
  return Math.max(WIDTH_MIN, Math.min(960, (typeof window === 'undefined' ? 1280 : window.innerWidth) - PAGE_MIN));
}

function readLayout(): { mode: PanelMode; width: number } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? 'null') as { mode?: unknown; width?: unknown } | null;
    const mode = raw?.mode === 'pinned' || raw?.mode === 'full' ? raw.mode : 'float';
    const width = typeof raw?.width === 'number' && Number.isFinite(raw.width) ? Math.round(raw.width) : WIDTH_DEFAULT;
    return { mode, width };
  } catch {
    return { mode: 'float', width: WIDTH_DEFAULT };
  }
}

function writeLayout(layout: { mode: PanelMode; width: number }) {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Sin storage: vale para esta pestaña.
  }
}

function Icon({ name }: { name: 'new' | 'history' | 'pin' | 'unpin' | 'expand' | 'collapse' | 'close' }) {
  const paths: Record<typeof name, string> = {
    new: 'M3 13h3l7-7-3-3-7 7v3zM9 4l3 3',
    history: 'M8 3.5a4.5 4.5 0 1 1-4.3 3.2M3 3v3h3M8 5.5V8l1.8 1.2',
    pin: 'M2.5 3.5h11v9h-11zM10 3.5v9',
    unpin: 'M2.5 3.5h11v9h-11zM6 6.5h5M6 9.5h3',
    expand: 'M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9',
    collapse: 'M13 3 9 7M9 3.5V7h3.5M3 13l4-4M7 12.5V9H3.5',
    close: 'M4 4l8 8M12 4l-8 8',
  };
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

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
 * toma la página actual y el texto seleccionado como contexto. Como en
 * Claude o ChatGPT: flota sobre la página, se fija al costado (la página se
 * corre) o va a pantalla completa, y se ensancha arrastrando el borde (el
 * ancho y el modo quedan guardados). En el teléfono es una hoja a pantalla
 * completa.
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
  const suggestions = useSuggestions(pathname, status?.webhooks === true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onPage = pathname.startsWith('/app/assistant');
  const [mode, setMode] = useState<PanelMode>('float');
  const [width, setWidth] = useState(WIDTH_DEFAULT);
  /** El modo de antes de pantalla completa (salir vuelve a ese). */
  const beforeFull = useRef<PanelMode>('float');
  useEffect(() => {
    const l = readLayout();
    setMode(l.mode);
    setWidth(l.width);
    if (l.mode !== 'full') beforeFull.current = l.mode;
  }, []);
  const changeMode = useCallback(
    (next: PanelMode) => {
      if (next === 'full') beforeFull.current = mode === 'full' ? beforeFull.current : mode;
      setMode(next);
      writeLayout({ mode: next, width });
    },
    [mode, width],
  );
  const shownWidth = Math.min(width, maxWidth());
  const pinned = open && mode === 'pinned';
  // Fijo al costado: la app se corre (no queda tapada). La variable la lee styles/assistant.css.
  useEffect(() => {
    const root = document.documentElement;
    if (!pinned) return;
    root.dataset.assistantPinned = '';
    root.style.setProperty('--asst-w', `${shownWidth}px`);
    return () => {
      delete root.dataset.assistantPinned;
      root.style.removeProperty('--asst-w');
    };
  }, [pinned, shownWidth]);
  // Capa de panel (lib/ui/layers.ts): al abrirse cierra los menús abiertos. Esc y el cierre los maneja el panel.
  useLayer(open, () => {}, { root: panelRef, kind: 'dialog', outside: false, escape: false });

  useEffect(() => {
    setConversationId(readStored());
  }, []);

  const capture = useCallback(() => {
    const selection = window.getSelection?.()?.toString().trim().slice(0, 1500) || undefined;
    setPage({ path: pathname.slice(0, 300), title: document.title.slice(0, 120), selection });
  }, [pathname]);

  const show = useCallback(
    (detail?: OpenAssistantDetail) => {
      // Desde un ítem de menú (el menú se cierra al abrir el panel): el foco vuelve a su botón.
      returnFocus.current = focusReturnTarget(document.activeElement);
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
      // Un campo que ya usó ⌘J (el borrador con IA de Inbox) se lo queda.
      if (e.defaultPrevented) return;
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

  // Con el panel abierto, navegar cambia el contexto: "esto" es la página nueva.
  useEffect(() => {
    if (open) capture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Esc cierra (salvo que un modal abierto lo use antes, como ⌘K o una confirmación). Con el foco en el panel
  // se atiende en la captura: la página de atrás (Inbox, que usa Esc) no se lo queda.
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent, inside: boolean) => {
      // Un modal de la página (⌘K, una confirmación) se queda con Esc; con el foco en el panel, es del panel.
      if (!inside && document.querySelector('dialog[open], [aria-modal="true"]')) return;
      if (mode === 'full') {
        e.preventDefault();
        changeMode(beforeFull.current);
        return;
      }
      // Fijo al costado es parte de la página: Esc en otra parte no lo cierra.
      if (mode === 'pinned' && !inside) return;
      e.preventDefault();
      close();
    };
    const onCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      // Flotante (o pantalla completa) es lo que está arriba de todo: Esc es suyo esté donde esté el foco
      // (después de "Confirmar" el foco queda en la página), salvo que haya un modal de la página abierto.
      const onTop = mode !== 'pinned' && !document.querySelector('dialog[open], [aria-modal="true"]');
      if (panelRef.current?.contains(document.activeElement) || onTop) handle(e, true);
    };
    const onBubble = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      handle(e, false);
    };
    window.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onBubble);
    return () => {
      window.removeEventListener('keydown', onCapture, true);
      window.removeEventListener('keydown', onBubble);
    };
  }, [open, close, mode, changeMode]);

  // ⌘J deja el foco en el campo: se reintenta un rato porque el campo aparece cuando llega el estado
  // y un editor de la página (Docs) puede recuperar el foco justo después del atajo.
  useEffect(() => {
    if (!open || status?.state !== 'ready') return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = inputRef.current;
      if (el && document.activeElement !== el && !panelRef.current?.contains(document.activeElement)) el.focus();
      if ((el && document.activeElement === el) || ++tries > 12) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
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
    <div
      className={`asst-panel is-${mode}`}
      role={mode === 'pinned' ? 'complementary' : 'dialog'}
      aria-label={t('title')}
      ref={panelRef}
      data-testid="assistant-panel"
      data-mode={mode}
      style={mode === 'full' ? undefined : ({ '--asst-w': `${shownWidth}px` } as React.CSSProperties)}
    >
      {mode !== 'full' && (
        <PanelSplitter
          className="asst-splitter"
          label={t('panel.resize')}
          hint={t('panel.resizeHint')}
          value={shownWidth}
          min={WIDTH_MIN}
          max={maxWidth()}
          side="end"
          onResize={setWidth}
          onCommit={(w) => writeLayout({ mode, width: w })}
          onReset={() => {
            setWidth(WIDTH_DEFAULT);
            writeLayout({ mode, width: WIDTH_DEFAULT });
          }}
        />
      )}
      <div className="asst-panel-head">
        <h2 className="asst-panel-title">{t('title')}</h2>
        <button
          type="button"
          className="asst-icon-btn"
          aria-label={t('newChat')}
          title={t('newChat')}
          onClick={() => {
            setConversationId(null);
            writeStored(null);
            setPrompt(null);
            setChatKey((k) => k + 1);
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          <Icon name="new" />
        </button>
        <Link
          href={conversationId ? `/app/assistant?c=${conversationId}` : '/app/assistant'}
          className="asst-icon-btn"
          aria-label={t('history')}
          title={t('history')}
          onClick={() => setOpen(false)}
        >
          <Icon name="history" />
        </Link>
        <button
          type="button"
          className="asst-icon-btn asst-only-wide"
          aria-label={t('panel.pin')}
          title={mode === 'pinned' ? t('panel.unpin') : t('panel.pin')}
          aria-pressed={mode === 'pinned'}
          data-testid="assistant-pin"
          onClick={() => changeMode(mode === 'pinned' ? 'float' : 'pinned')}
        >
          <Icon name={mode === 'pinned' ? 'unpin' : 'pin'} />
        </button>
        <button
          type="button"
          className="asst-icon-btn asst-only-wide"
          aria-label={t('panel.expand')}
          title={mode === 'full' ? t('panel.collapse') : t('panel.expand')}
          aria-pressed={mode === 'full'}
          data-testid="assistant-expand"
          onClick={() => changeMode(mode === 'full' ? beforeFull.current : 'full')}
        >
          <Icon name={mode === 'full' ? 'collapse' : 'expand'} />
        </button>
        <button type="button" className="asst-icon-btn" onClick={close} aria-label={t('close')} title={`${t('close')} (Esc)`}>
          <Icon name="close" />
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
