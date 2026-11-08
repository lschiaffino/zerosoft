'use client';

import LocalText from '@/components/ui/LocalText';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import type { ChatDto, MessageDto } from '@/lib/groups';
import { MAX_FORWARD_TARGETS, formatDuration } from '@/lib/groups-inbox-rules';
import { ChatPlate, Modal, api, useErrorText, useMediaText } from './ui';
import { parseDbUtc } from '@/lib/utils';

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Ícono a la izquierda (el menú de adjuntar los muestra en círculos de color). */
  icon?: ReactNode;
  /** Separa este ítem de los anteriores (acciones del equipo debajo de las de WhatsApp). */
  divider?: boolean;
}

/**
 * Menú (⋯ o la flecha de un mensaje): role="menu", flechas para moverse, Esc
 * cierra y devuelve el foco al botón, clic afuera también cierra. La lista va
 * en un portal con posición fija: se abre hacia arriba si abajo no entra y
 * nunca queda tapada por el composer ni cortada por el borde de la ventana.
 */
export function MessageMenu({
  label,
  items,
  trigger,
  className = 'btn btn-ghost btn-sm',
  align,
  onOpenChange,
}: {
  label: string;
  items: MenuItem[];
  /** Contenido del botón (por defecto ⋯). */
  trigger?: ReactNode;
  className?: string;
  /** Lado hacia el que abre la lista (por defecto, alineada a la derecha del botón). */
  align?: 'left' | 'right';
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const setOpen = (v: boolean | ((p: boolean) => boolean)) =>
    setOpenState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (next !== prev) onOpenChange?.(next);
      return next;
    });

  // Posición: debajo del botón si entra; si no, arriba. Siempre dentro de la ventana.
  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return;
    const b = button.current.getBoundingClientRect();
    const l = list.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 4;
    const below = vh - b.bottom - gap - 8;
    const above = b.top - gap - 8;
    const up = l.height > below && above > below;
    const maxHeight = Math.max(120, up ? above : below);
    const h = Math.min(l.height, maxHeight);
    const top = up ? b.top - gap - h : b.bottom + gap;
    let left = align === 'left' ? b.left : b.right - l.width;
    left = Math.min(Math.max(8, left), vw - l.width - 8);
    setPos({ top, left, maxHeight });
  }, [open, align, items.length]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (button.current?.contains(t) || list.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    // Si se scrollea lo de atrás (no el propio menú), se cierra: la posición dejó de valer.
    const onScroll = (e: Event) => {
      if (list.current && e.target instanceof Node && list.current.contains(e.target)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length];
      next?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  }

  if (items.length === 0) return null;
  const listEl = open ? (
    <div
      className={`gr-menu-list is-portal${items.some((it) => it.icon) ? ' has-icons' : ''}`}
      role="menu"
      aria-label={label}
      ref={list}
      onKeyDown={onKey}
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { top: -9999, left: -9999 }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          className={`gr-menu-item${it.danger ? ' gr-danger' : ''}${it.divider ? ' has-divider' : ''}`}
          onClick={() => {
            setOpen(false);
            it.onSelect();
          }}
        >
          {it.icon && <span className={`gr-menu-icon is-${it.key}`}>{it.icon}</span>}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  ) : null;
  return (
    <span className="gr-menu">
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger ?? '⋯'}
      </button>
      {listEl && typeof document !== 'undefined' ? createPortal(listEl, document.body) : null}
    </span>
  );
}

/** Línea de sistema del hilo: llamada o evento del historial (asignación, equipo, cierre). */
export function SystemLine({ m, nameOf }: { m: MessageDto; nameOf: (id: string | null | undefined) => string }) {
  const t = useTranslations('groups.history');
  const locale = useLocale();
  const time = parseDbUtc(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const meta = m.meta as Record<string, string | number | boolean | undefined>;
  let text: ReactNode = '';
  let extra: ReactNode = null;
  if (m.authorKind === 'call') {
    const dir = meta.direction === 'out' ? 'out' : 'in';
    const status = String(meta.status ?? 'ringing');
    const key = status === 'missed' || status === 'rejected' ? `call_${status}_${dir}` : `call_${dir}`;
    text = t(key);
    if (Number(meta.durationSec) > 0) extra = <span className="gr-call-len">{formatDuration(Number(meta.durationSec))}</span>;
    else if (status === 'ringing') extra = <span className="ui-help">{t('call_ringing')}</span>;
    else if (status === 'answered') extra = <span className="ui-help">{t('call_answered')}</span>;
    if (typeof meta.recordingUrl === 'string' && meta.recordingUrl) {
      extra = (
        <>
          {extra}{' '}
          <a href={meta.recordingUrl} target="_blank" rel="noreferrer">
            {t('recording')}
          </a>
        </>
      );
    }
  } else {
    const by = nameOf(meta.by as string | undefined) || t('someone');
    const to = nameOf(meta.to as string | undefined);
    switch (meta.event) {
      case 'assigned':
        // Quien se lo toma a sí mismo: "se asignó el chat", como en la auditoría.
        text = meta.by && meta.by === meta.to ? t('assignedSelf', { by }) : t('assigned', { by, to });
        break;
      case 'unassigned':
        text = t('unassigned', { by });
        break;
      case 'auto_assigned':
        text = t('autoAssigned', { to, rule: String(meta.rule ?? '') });
        break;
      case 'team':
        text = meta.team ? t('team', { by, team: String(meta.teamName ?? '') }) : t('noTeam', { by });
        break;
      case 'closed':
        text = t('closed', { by });
        break;
      case 'reopened':
        text = t('reopened', { by });
        break;
      default:
        return null;
    }
  }
  return (
    <p className={`gr-system${m.authorKind === 'call' ? ' gr-system-call' : ''}`} id={`m-${m.id}`}>
      {m.authorKind === 'call' && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
      )}
      <span>{text}</span>
      {extra}
      <time dateTime={m.createdAt}><LocalText>{time}</LocalText></time>
    </p>
  );
}

/** Mensajes fijados, arriba del hilo: clic va al mensaje, × lo desfija. */
export function PinnedBar({ pinned, onJump, onUnpin }: { pinned: MessageDto[]; onJump: (m: MessageDto) => void; onUnpin: (m: MessageDto) => void }) {
  const t = useTranslations('groups.thread');
  const mediaText = useMediaText();
  if (pinned.length === 0) return null;
  return (
    <div className="gr-pinned" role="region" aria-label={t('pinnedTitle')}>
      {pinned.map((m) => (
        <div key={m.id} className="gr-pinned-row">
          <button type="button" className="gr-pinned-jump" onClick={() => onJump(m)}>
            <span className="gr-pinned-tag">{t('pinned')}</span>
            <span className="gr-pinned-text">{m.body.slice(0, 120) || mediaText({ media: m.media })}</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUnpin(m)} aria-label={t('unpinLabel')}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Reenviar un mensaje: buscar chats, marcar hasta 10 y mandar. */
export function ForwardModal({
  message,
  fromChatId,
  onClose,
  onDone,
}: {
  message: MessageDto | null;
  fromChatId: string;
  onClose: () => void;
  onDone: (results: Array<{ chatId: string; name: string; ok: boolean; error?: string }>) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const mediaText = useMediaText();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ChatDto[] | null>(null);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!message) return;
    setPicked(new Map());
    setError('');
    setQ('');
  }, [message]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(async () => {
      const p = new URLSearchParams({ limit: '20' });
      if (q.trim()) p.set('q', q.trim());
      const res = await api<{ rows: ChatDto[] }>(`/api/groups/chats?${p}`);
      setRows((res.data?.rows ?? []).filter((r) => r.id !== fromChatId));
    }, 200);
    return () => clearTimeout(id);
  }, [q, message, fromChatId]);

  async function submit() {
    if (!message || picked.size === 0) return;
    setBusy(true);
    setError('');
    const res = await api<{ results: Array<{ chatId: string; name: string; ok: boolean; error?: string }> }>(`/api/groups/messages/${message.id}`, {
      body: { action: 'forward', chatIds: [...picked.keys()] },
    });
    setBusy(false);
    if (!res.data) {
      setError(errText(res.error));
      return;
    }
    onDone(res.data.results);
  }

  return (
    <Modal
      open={!!message}
      title={t('forward.title')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={picked.size === 0} aria-busy={busy || undefined}>
            {picked.size > 0 ? t('forward.sendTo', { n: picked.size }) : t('forward.send')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {message && <p className="gr-quote">{message.body.slice(0, 200) || mediaText({ media: message.media })}</p>}
        <label className="ui-field">
          <span className="label">{t('forward.search')}</span>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        {rows === null ? (
          <p className="ui-help" aria-busy="true">
            {t('common.loading')}
          </p>
        ) : rows.length === 0 ? (
          <p className="ui-help">{t('forward.empty')}</p>
        ) : (
          <ul className="gr-forward-list">
            {rows.map((r) => (
              <li key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(r.id)}
                    disabled={!picked.has(r.id) && picked.size >= MAX_FORWARD_TARGETS}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Map(prev);
                        if (e.target.checked) next.set(r.id, r.name);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                  />
                  <ChatPlate name={r.name} kind={r.kind} />
                  <span>{r.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="ui-help">{t('forward.help', { n: MAX_FORWARD_TARGETS })}</p>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
