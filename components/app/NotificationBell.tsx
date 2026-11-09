'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import Icon from './icons';
import { relDate } from '@/lib/utils';
import { useVisiblePoll } from '@/lib/use-visible-poll';
import { useLayer } from '@/lib/ui/layers';
import { notificationTitle, type NotificationTextLabels } from '@/lib/notification-text';

/** Evento que dispara quien cambia avisos (la bandeja) para que la campana se actualice. */
export const NOTIFICATIONS_CHANGED_EVENT = 'zs:notifications-changed';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  meta?: string | null;
  source_type?: string | null;
}

interface NotificationBellProps {
  labels: {
    title: string;
    markRead: string;
    markAllRead: string;
    empty: string;
    loading: string;
    loadError: string;
    text: NotificationTextLabels;
  };
  onCountChange?: (count: number) => void;
}

export default function NotificationBell({ labels, onCountChange }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Hasta la primera respuesta no se sabe si está vacía; si falló, tampoco.
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();

  // Los pospuestos no cuentan ni se listan (el API los excluye). Se recarga al
  // abrir y cuando la bandeja avisa un cambio, para no mostrar un estado viejo.
  const load = useCallback(async () => {
    const res = await fetch('/api/notifications?limit=5').catch(() => null);
    if (!res?.ok) {
      setState((s) => (s === 'ready' ? s : 'error'));
      return;
    }
    const data = (await res.json()) as { rows: Notification[]; unreadCount: number };
    setState('ready');
    setNotifications(data.rows ?? []);
    setUnreadCount(data.unreadCount ?? 0);
    onCountChange?.(data.unreadCount ?? 0);
  }, [onCountChange]);

  // Cada 30 s con la pestaña visible, y al volver a ella; oculta no pide nada.
  // La primera, con el navegador libre: no compite con los datos de la página.
  useVisiblePoll(load, 30_000, { idleStart: true });
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
  }, [load]);

  // Una capa más (lib/ui/layers.ts): abrirla cierra los menús abiertos; clic afuera y Esc la cierran.
  useLayer(open, () => setOpen(false), { root: ref, trigger: btnRef, panel: panelRef });

  async function markRead(id: string) {
    const res = await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    if (res.ok) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
      );
      setUnreadCount((c) => {
        const next = Math.max(0, c - 1);
        onCountChange?.(next);
        return next;
      });
    }
  }

  async function markAllRead() {
    const res = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readAll: true }),
    });
    if (res.ok) {
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
      setUnreadCount(0);
      onCountChange?.(0);
    }
  }

  function handleClick(n: Notification) {
    if (!n.read_at) markRead(n.id);
    setOpen(false);
  }

  return (
    <div className="side-bell-wrap" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="side-bell"
        onClick={() => {
          if (!open) void load();
          setOpen((v) => !v);
        }}
        aria-label={labels.title}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="side-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <div ref={panelRef} className="side-bell-panel">
          <div className="side-bell-header">
            <span className="side-bell-title">{labels.title}</span>
            {unreadCount > 0 && (
              <button type="button" className="side-bell-markall" onClick={markAllRead}>
                {labels.markAllRead}
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="side-bell-empty" role="status" data-testid="bell-empty">
              {state === 'loading' ? labels.loading : state === 'error' ? labels.loadError : labels.empty}
            </p>
          ) : (
            <div className="side-bell-list">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.href ?? '/app/track'}
                  className={`side-bell-item${n.read_at ? '' : ' unread'}`}
                  onClick={() => handleClick(n)}
                >
                  <span className="side-bell-item-title">{notificationTitle(n, labels.text)}</span>
                  {n.body && <span className="side-bell-item-body">{n.body}</span>}
                  <span className="side-bell-item-meta">
                    {!n.read_at && <span className="side-bell-dot" />}
                    <time dateTime={n.created_at}><LocalText>{relDate(n.created_at, locale)}</LocalText></time>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
