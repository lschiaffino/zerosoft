'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { INFO_ROWS, infoSections, type WaMessageInfo, type WaReceiptPerson } from '@/lib/wa-receipts';
import Avatar from './Avatar';
import { formatWaPhone } from './format';
import { Close, Mic, Ticks } from './icons';
import { useDismiss } from './useDismiss';

/**
 * Info del mensaje, como el panel de WhatsApp: al lado del mensaje (en el
 * teléfono, una hoja desde abajo), con el mensaje arriba y, en un grupo,
 * "Leído por" y "Entregado a" con la foto, el nombre y la hora de cada
 * persona; en un 1:1, "Leído" y "Entregado" con su hora. La comparten Lines
 * (components/groups/ChatThread.tsx) e Inbox (components/inbox/wa/WaConversation.tsx).
 * Los datos: lib/wa-receipts.ts.
 */

const SHEET_QUERY = '(max-width: 600px)';

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function MessageInfo({
  anchor,
  load,
  preview,
  previewTime,
  status,
  statusLabel,
  by,
  onClose,
}: {
  /** El globito del mensaje: el cuadro se abre a su lado. */
  anchor: HTMLElement;
  /** Pide la info al servidor (null si falló). */
  load: () => Promise<WaMessageInfo | null>;
  /** El texto del mensaje (o lo que lo describe: "Foto", "Audio"). */
  preview: ReactNode;
  /** La hora del mensaje, como en el globito. */
  previewTime: string;
  status: string;
  statusLabel: string;
  /** Lines: quién del equipo lo mandó (o "desde el teléfono"). */
  by?: string;
  onClose: (restoreFocus: boolean) => void;
}) {
  const t = useTranslations('groups.wa.info');
  const someone = useTranslations('groups.wa')('someone');
  const locale = useLocale();
  const titleId = useId();
  const pop = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<WaMessageInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(SHEET_QUERY).matches);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const chatStyle = anchor.closest<HTMLElement>('[data-chat-style]')?.dataset.chatStyle;

  const loadRef = useRef(load);
  loadRef.current = load;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fetchInfo = useCallback(() => {
    let live = true;
    setFailed(false);
    void loadRef.current().then((info) => {
      if (!live) return;
      if (info) setData(info);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => fetchInfo(), [fetchInfo]);

  useEffect(() => {
    const mq = window.matchMedia?.(SHEET_QUERY);
    if (!mq) return;
    const on = () => setSheet(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Al lado del globito (a la izquierda de uno propio), alineado con su borde de arriba; si no entra al costado,
  // debajo o encima. Siempre dentro de la ventana.
  useLayoutEffect(() => {
    if (sheet || !pop.current) return;
    const a = anchor.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const clampTop = (top: number) => Math.min(Math.max(8, top), Math.max(8, vh - p.height - 8));
    const clampLeft = (left: number) => Math.min(Math.max(8, left), Math.max(8, vw - p.width - 8));
    if (a.left - gap - p.width >= 8) return setPos({ top: clampTop(a.top), left: a.left - gap - p.width });
    if (a.right + gap + p.width <= vw - 8) return setPos({ top: clampTop(a.top), left: a.right + gap });
    const below = vh - a.bottom - gap - 8;
    const up = p.height > below && a.top - gap - 8 > below;
    setPos({ top: clampTop(up ? a.top - gap - p.height : a.bottom + gap), left: clampLeft(a.right - p.width) });
  }, [anchor, sheet, data, failed, open]);

  // Al abrir, el foco entra al cuadro (Tab llega a cerrar y a "ver más"); al cerrar con Esc vuelve a donde estaba.
  const before = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  useEffect(() => {
    pop.current?.focus({ preventScroll: true });
  }, []);
  const close = useCallback((restore: boolean) => {
    const prev = before.current;
    closeRef.current(restore);
    if (!restore) return;
    // Donde estaba el foco; si ya no está (el ítem del menú que lo abrió), el botón de acciones del mensaje.
    const target =
      prev instanceof HTMLElement && prev.isConnected && prev !== document.body ? prev : anchor.closest('.gr-msg')?.querySelector<HTMLElement>('button[aria-haspopup]');
    target?.focus({ preventScroll: true });
  }, [anchor]);

  useDismiss(true, (reason) => close(reason === 'escape'), [pop, backdrop]);
  // Se mueve lo que tiene al globito (scroll del chat) o cambia el tamaño: se cierra, como el de reacciones.
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

  const when = useCallback(
    (iso: string | null): string => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
      const day = sameDay(d, now)
        ? t('today')
        : sameDay(d, yesterday)
          ? t('yesterday')
          : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
      return t('at', { day, time });
    },
    [locale, t],
  );

  const sections = useMemo(() => (data?.group ? infoSections(data.people, data.voice) : null), [data]);
  const loading = data === null && !failed;

  const personRow = (p: WaReceiptPerson, at: string | null) => {
    const phone = formatWaPhone(p.phone, p.masked);
    const name = p.name ? (p.pushName ? `~${p.name}` : p.name) : phone || someone;
    const sub = p.name ? phone : '';
    return (
      <li key={p.key} className="wa-rx-row wa-info-row" data-testid="wa-info-person">
        <Avatar name={p.name || name} kind="dm" size={40} src={p.picture || undefined} seed={p.phone || p.name || p.key} />
        <span className="wa-rx-who">
          <span className="wa-rx-name" data-testid="wa-info-person-name">
            {name}
          </span>
          {sub && <span className="wa-rx-sub">{sub}</span>}
        </span>
        <time className="wa-info-when" dateTime={at ?? undefined} data-testid="wa-info-person-time">
          {when(at)}
        </time>
      </li>
    );
  };

  const section = (key: 'played' | 'read' | 'delivered', list: WaReceiptPerson[]) => {
    if (!list.length) return null;
    const expanded = !!open[key];
    const shown = expanded ? list : list.slice(0, INFO_ROWS);
    const rest = list.length - shown.length;
    const label = key === 'played' ? t('playedBy') : key === 'read' ? t('readBy') : t('deliveredTo');
    const headId = `${titleId}-${key}`;
    return (
      <section className="wa-info-section" data-testid={`wa-info-${key}`} aria-labelledby={headId}>
        <h3 className="wa-info-section-head" id={headId}>
          <span className="wa-info-section-icon" aria-hidden="true">
            {key === 'played' ? <Mic size={16} /> : <Ticks status={key === 'read' ? 'read' : 'delivered'} label="" />}
          </span>
          <span>{label}</span>
          <span className="wa-info-count">{list.length}</span>
        </h3>
        <ul className="wa-rx-list">{shown.map((p) => personRow(p, key === 'played' ? p.playedAt : key === 'read' ? p.readAt : p.deliveredAt))}</ul>
        {(rest > 0 || expanded) && list.length > INFO_ROWS && (
          <button type="button" className="wa-info-more" aria-expanded={expanded} data-testid="wa-info-more" onClick={() => setOpen((o) => ({ ...o, [key]: !expanded }))}>
            {expanded ? t('less') : t('more', { count: rest })}
          </button>
        )}
      </section>
    );
  };

  const directRow = (key: 'read' | 'delivered' | 'played', at: string | null, reached: boolean) => (
    <div className="wa-info-direct-row" data-testid={`wa-info-${key}`}>
      <span className="wa-info-section-icon" aria-hidden="true">
        {key === 'played' ? <Mic size={16} /> : <Ticks status={key} label="" />}
      </span>
      <span className="wa-info-direct-label">{t(key)}</span>
      <time className="wa-info-when" dateTime={at ?? undefined} data-testid={`wa-info-${key}-time`}>
        {at ? when(at) : reached ? t('noTime') : t('notYet')}
      </time>
    </div>
  );

  const reachedRead = status === 'read';
  const reachedDelivered = status === 'read' || status === 'delivered';

  const body = (
    <div
      ref={pop}
      className={`wa-rx-pop wa-info-pop${sheet ? ' is-sheet' : ''}`}
      data-chat-style={chatStyle}
      data-testid="wa-message-info"
      role="dialog"
      aria-modal={sheet ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={sheet ? undefined : pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {sheet && <span className="wa-rx-grip" aria-hidden="true" />}
      <div className="wa-info-head">
        <h2 className="wa-rx-title" id={titleId}>
          {t('title')}
        </h2>
        <button type="button" className="wa-info-close" aria-label={t('close')} title={t('close')} data-testid="wa-info-close" onClick={() => close(true)}>
          <Close size={18} />
        </button>
      </div>
      <div className="wa-info-preview">
        <div className="wa-info-bubble">
          <span className="wa-info-text">{preview}</span>
          <span className="wa-info-meta">
            {previewTime}
            {status && <Ticks status={status} label={statusLabel} />}
          </span>
        </div>
      </div>
      <div className="wa-rx-panel wa-info-panel" aria-busy={loading || undefined}>
        {failed ? (
          <p className="wa-rx-error" role="alert">
            {t('error')}{' '}
            <button type="button" className="wa-rx-retry" onClick={() => fetchInfo()}>
              {t('retry')}
            </button>
          </p>
        ) : loading ? (
          <ul className="wa-rx-list" aria-label={t('loading')}>
            {[0, 1, 2].map((i) => (
              <li key={i} className="wa-rx-row is-skeleton" aria-hidden="true">
                <span className="wa-rx-skel-avatar" />
                <span className="wa-rx-who">
                  <span className="wa-rx-skel-line" />
                  <span className="wa-rx-skel-line is-short" />
                </span>
              </li>
            ))}
          </ul>
        ) : data && sections ? (
          <>
            {section('played', sections.played)}
            {section('read', sections.read)}
            {section('delivered', sections.delivered)}
            {!data.unavailable && !sections.played.length && !sections.read.length && !sections.delivered.length && <p className="wa-info-note">{t('nobody')}</p>}
            {data.unavailable && (
              <p className="wa-info-note" data-testid="wa-info-unavailable">
                {t('unavailable')}
              </p>
            )}
          </>
        ) : data ? (
          <div className="wa-info-direct">
            {data.voice && data.playedAt && directRow('played', data.playedAt, true)}
            {directRow('read', data.readAt, reachedRead)}
            {directRow('delivered', data.deliveredAt, reachedDelivered)}
          </div>
        ) : null}
        {data && (
          <div className="wa-info-sent" data-testid="wa-info-sent">
            <span>{t('sent')}</span>
            <time dateTime={data.sentAt}>{when(data.sentAt)}</time>
          </div>
        )}
        {data && by && (
          <div className="wa-info-sent" data-testid="wa-info-by">
            <span>{t('by')}</span>
            <span className="wa-info-by">{by}</span>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(
    sheet ? (
      <div ref={backdrop} className="wa-rx-backdrop" data-chat-style={chatStyle} onClick={(e) => e.target === e.currentTarget && close(false)}>
        {body}
      </div>
    ) : (
      body
    ),
    document.body,
  );
}
