'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { filterReactors, reactionTabs, sortReactors, type WaReactor } from '@/lib/wa-reactions';
import Avatar from './Avatar';
import { formatWaPhone } from './format';
import { SmileyPlus } from './icons';
import { longPress } from './longPress';
import { useDismiss } from './useDismiss';

/** Lo que el mensaje ya sabe de cada reacción (sin pedir nada): alcanza para el globito, el título y las pestañas. */
export interface ReactionLite {
  messageId: string;
  emoji: string;
  me: boolean;
}

/**
 * El globito de reacciones debajo de un mensaje (hasta tres emojis, los más
 * usados, y el total), como WhatsApp. Clic, Enter o un toque largo abren el
 * cuadro de quién reaccionó. Lo usan Inbox y Lines.
 */
export function ReactionChip({
  reactions,
  className = '',
  expanded,
  onOpen,
}: {
  reactions: ReactionLite[];
  className?: string;
  expanded: boolean;
  onOpen: (anchor: HTMLElement) => void;
}) {
  const t = useTranslations('groups.wa.reactions');
  const tabs = reactionTabs(reactions);
  const press = longPress((el) => {
    el.dataset.rxKeyboard = '';
    onOpen(el);
  });
  if (!tabs.length) return null;
  return (
    <button
      type="button"
      className={`gr-reactions wa-rx-chip ${className}`.trim()}
      data-testid="wa-reactions-chip"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={t('chip', { count: reactions.length, list: tabs.map((x) => `${x.emoji} ${x.count}`).join(', ') })}
      {...press}
      onPointerDown={(e) => {
        // El toque largo del globito no abre además el menú del mensaje.
        e.stopPropagation();
        press.onPointerDown(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        // Enter o espacio (un clic sin puntero): el cuadro abre con el foco en las pestañas.
        e.currentTarget.dataset.rxKeyboard = e.detail === 0 ? '1' : '';
        onOpen(e.currentTarget);
      }}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Enter lo abre acá: los atajos de la app (Enter abre el chat de la lista en Inbox) no se lo llevan.
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.dataset.rxKeyboard = '1';
        onOpen(e.currentTarget);
      }}
    >
      {tabs.slice(0, 3).map((x) => (
        <span key={x.emoji}>{x.emoji}</span>
      ))}
      {reactions.length > 1 && <b>{reactions.length}</b>}
    </button>
  );
}

const SHEET_QUERY = '(max-width: 600px)';

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Quién reaccionó a un mensaje, como el cuadro de WhatsApp Web: "N reacciones",
 * el botón para reaccionar, una pestaña por emoji (y "Todas" si hay más de uno)
 * y la lista con foto, nombre ("~Nombre" si es el de perfil), teléfono y su
 * emoji. La propia va primero como "Tú": un clic la saca. Anclado al globito;
 * Esc, un clic afuera o el scroll lo cierran. En el teléfono es una hoja abajo.
 */
export function ReactionDetails({
  anchor,
  reactions,
  load,
  me,
  canReact,
  align,
  onReact,
  onRemove,
  onClose,
}: {
  anchor: HTMLElement;
  /** Lo que el mensaje ya sabe (se ve al instante; la lista completa llega con `load`). */
  reactions: ReactionLite[];
  /** Pide el detalle al servidor (null si falló). */
  load: () => Promise<WaReactor[] | null>;
  me: { picture?: string };
  /** Se puede reaccionar (conectado, mensaje vivo). */
  canReact: boolean;
  /** Hacia dónde abre (los recibidos a la izquierda, los propios a la derecha). */
  align: 'left' | 'right';
  onReact: () => void;
  onRemove: (r: { messageId: string; emoji: string }) => Promise<unknown> | void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const t = useTranslations('groups.wa.reactions');
  const someone = useTranslations('groups.wa')('someone');
  const titleId = useId();
  const panelId = useId();
  const pop = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<WaReactor[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [sheet, setSheet] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(SHEET_QUERY).matches);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [removing, setRemoving] = useState(false);
  const chatStyle = anchor.closest<HTMLElement>('[data-chat-style]')?.dataset.chatStyle;

  // Lo que cambia en el mensaje (llegó otra reacción, se sacó la propia) vuelve a pedir la lista.
  const signature = reactions.map((r) => `${r.messageId}:${r.emoji}:${r.me ? 1 : 0}`).join('|');
  const loadRef = useRef(load);
  loadRef.current = load;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fetchList = useCallback(() => {
    let live = true;
    setFailed(false);
    void loadRef.current().then((list) => {
      if (!live) return;
      setRemoving(false);
      if (list) setData(list);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    // Sin reacciones (se sacó la última) no queda nada que mostrar.
    if (!signature) return closeRef.current(true);
    return fetchList();
  }, [signature, fetchList]);

  const list = useMemo(() => sortReactors(data ?? []), [data]);
  // Título y pestañas: de la lista cuando llegó; antes, de lo que sabe el mensaje.
  const source = data ?? reactions;
  const tabs = reactionTabs(source);
  const total = source.length;
  const several = tabs.length > 1;
  const active = several ? tab : (tabs[0]?.emoji ?? null);
  // Una pestaña que se quedó sin reacciones vuelve a "Todas".
  useEffect(() => {
    if (tab && !tabs.some((x) => x.emoji === tab)) setTab(null);
  }, [tab, tabs]);
  const shown = filterReactors(list, active);

  useEffect(() => {
    const mq = window.matchMedia?.(SHEET_QUERY);
    if (!mq) return;
    const on = () => setSheet(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Posición: debajo del globito si entra; si no, arriba. Siempre dentro de la ventana.
  useLayoutEffect(() => {
    if (sheet || !pop.current) return;
    const a = anchor.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    const below = vh - a.bottom - gap - 8;
    const up = p.height > below && a.top - gap - 8 > below;
    const top = Math.max(8, up ? a.top - gap - p.height : a.bottom + gap);
    let left = align === 'left' ? a.left : a.right - p.width;
    left = Math.min(Math.max(8, left), vw - p.width - 8);
    setPos({ top, left });
  }, [anchor, align, sheet, shown.length, total, data === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir, el foco entra al cuadro. Desde el teclado, a la pestaña elegida (con su anillo); con el mouse o
  // el dedo, al cuadro mismo (sin anillo): Tab entra a las pestañas y las flechas las recorren igual.
  const byKeyboard = useRef(anchor.dataset.rxKeyboard === '1');
  useEffect(() => {
    const root = pop.current;
    if (!root) return;
    const target = byKeyboard.current ? (root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? focusables(root)[0]) : root;
    target?.focus({ preventScroll: true });
  }, []);

  // Esc (el foco vuelve al globito), un toque afuera u otro overlay que se abre: se cierra (./useDismiss.ts).
  // El globito lo alterna; el fondo de la hoja la cierra con su propio clic (así ese toque no llega al chat de abajo).
  useDismiss(true, (reason) => closeRef.current(reason === 'escape'), [pop, () => anchor, backdrop]);
  // Scroll de lo que mueve el globito o cambio de tamaño: se cierra.
  useEffect(() => {
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && pop.current?.contains(target)) return;
      if (!(target instanceof Node) || target.contains(anchor)) closeRef.current(false);
    };
    const onResize = () => {
      if (!window.matchMedia?.(SHEET_QUERY).matches) closeRef.current(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor]);

  // Tab da la vuelta dentro del cuadro (es un diálogo).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Con el foco en el cuadro mismo (se abrió con el mouse), las flechas mueven las pestañas.
    if (e.target === pop.current && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return onTabKey(e);
    if (e.key !== 'Tab') return;
    const all = focusables(pop.current);
    if (!all.length) return;
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      all[all.length - 1].focus();
    } else if (!e.shiftKey && i === all.length - 1) {
      e.preventDefault();
      all[0].focus();
    }
  };

  // Flechas entre las pestañas (se elige al moverse), Inicio y Fin.
  const tabKeys: Array<string | null> = several ? [null, ...tabs.map((x) => x.emoji)] : tabs.map((x) => x.emoji);
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = tabKeys.indexOf(active);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabKeys.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabKeys.length) % tabKeys.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabKeys.length - 1;
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      pop.current?.querySelector<HTMLElement>('.wa-rx-row.is-me')?.focus();
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    setTab(tabKeys[next]);
    pop.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  const loading = data === null && !failed;
  const skeleton = Math.min(Math.max(reactions.filter((r) => active === null || r.emoji === active).length, 1), 4);

  const body = (
    <div
      ref={pop}
      className={`wa-rx-pop${sheet ? ' is-sheet' : ''}`}
      data-chat-style={chatStyle}
      data-testid="wa-reactions-popover"
      role="dialog"
      aria-modal={sheet ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={sheet ? undefined : pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {sheet && <span className="wa-rx-grip" aria-hidden="true" />}
      <h2 className="wa-rx-title" id={titleId}>
        {t('title', { count: total })}
      </h2>
      <div className="wa-rx-tabs">
        {canReact && (
          <button type="button" className="wa-rx-react" onClick={onReact} aria-label={t('react')} title={t('react')} data-testid="wa-reactions-react">
            <SmileyPlus size={20} />
          </button>
        )}
        <div className="wa-rx-tablist" role="tablist" aria-label={t('tabs')} onKeyDown={onTabKey}>
          {tabKeys.map((key) => {
            const count = key === null ? total : (tabs.find((x) => x.emoji === key)?.count ?? 0);
            const selected = key === active;
            return (
              <button
                key={key ?? '*'}
                type="button"
                role="tab"
                className="wa-rx-tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                data-testid="wa-reactions-tab"
                data-emoji={key ?? ''}
                aria-label={key === null ? `${t('all')} ${count}` : t('tab', { emoji: key, count })}
                onClick={() => setTab(key)}
              >
                {key === null ? <span>{t('all')}</span> : <span className="wa-rx-tab-emoji">{key}</span>}
                <span className="wa-rx-tab-n">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="wa-rx-panel" id={panelId} role="tabpanel" aria-label={t('list')} aria-busy={loading || undefined}>
        {failed ? (
          <p className="wa-rx-error" role="alert">
            {t('error')}{' '}
            <button type="button" className="wa-rx-retry" onClick={() => fetchList()}>
              {t('retry')}
            </button>
          </p>
        ) : loading ? (
          <ul className="wa-rx-list" aria-label={t('loading')}>
            {Array.from({ length: skeleton }, (_, i) => (
              <li key={i} className="wa-rx-row is-skeleton" aria-hidden="true">
                <span className="wa-rx-skel-avatar" />
                <span className="wa-rx-who">
                  <span className="wa-rx-skel-line" />
                  <span className="wa-rx-skel-line is-short" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="wa-rx-list">
            {shown.map((r) => {
              if (r.me) {
                return (
                  <li key={`me:${r.messageId}`}>
                    <button
                      type="button"
                      className="wa-rx-row is-me"
                      data-testid="wa-reactor-me"
                      aria-label={`${t('you')}, ${r.emoji}. ${t('remove', { emoji: r.emoji })}`}
                      disabled={removing}
                      onClick={() => {
                        setRemoving(true);
                        void Promise.resolve(onRemove({ messageId: r.messageId, emoji: r.emoji })).finally(() => setRemoving(false));
                      }}
                    >
                      <Avatar name={t('you')} kind="dm" size={40} src={me.picture || undefined} seed="me" />
                      <span className="wa-rx-who">
                        <span className="wa-rx-name">{t('you')}</span>
                        <span className="wa-rx-sub">{t('clickToRemove')}</span>
                      </span>
                      <span className="wa-rx-emoji" aria-hidden="true">
                        {r.emoji}
                      </span>
                    </button>
                  </li>
                );
              }
              const phone = formatWaPhone(r.phone, r.masked);
              const name = r.name ? (r.pushName ? `~${r.name}` : r.name) : phone || someone;
              const sub = r.name ? phone : '';
              return (
                <li key={`${r.messageId}:${r.phone}:${r.name}:${r.emoji}`} className="wa-rx-row" data-testid="wa-reactor">
                  <Avatar name={r.name || name} kind="dm" size={40} src={r.picture || undefined} seed={r.phone || r.name} />
                  <span className="wa-rx-who">
                    <span className="wa-rx-name" data-testid="wa-reactor-name">
                      {name}
                    </span>
                    {sub && (
                      <span className="wa-rx-sub" data-testid="wa-reactor-phone">
                        {sub}
                      </span>
                    )}
                  </span>
                  <span className="wa-rx-emoji" aria-label={r.emoji}>
                    {r.emoji}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(
    sheet ? (
      <div ref={backdrop} className="wa-rx-backdrop" data-chat-style={chatStyle} onClick={(e) => e.target === e.currentTarget && onClose(false)}>
        {body}
      </div>
    ) : (
      body
    ),
    document.body,
  );
}
