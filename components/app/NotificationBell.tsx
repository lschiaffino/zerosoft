'use client';

import { useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import Icon from './icons';
import { relDate } from '@/lib/utils';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationBellProps {
  labels: {
    title: string;
    markRead: string;
    markAllRead: string;
    empty: string;
  };
  onCountChange?: (count: number) => void;
}

export default function NotificationBell({ labels, onCountChange }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/notifications?limit=5');
      if (!res.ok) return;
      const data = (await res.json()) as { rows: Notification[]; unreadCount: number };
      setNotifications(data.rows ?? []);
      setUnreadCount(data.unreadCount ?? 0);
      onCountChange?.(data.unreadCount ?? 0);
    }
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [onCountChange]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

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
        type="button"
        className="side-bell"
        onClick={() => setOpen((v) => !v)}
        aria-label={labels.title}
        aria-expanded={open}
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="side-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <div className="side-bell-panel">
          <div className="side-bell-header">
            <span className="side-bell-title">{labels.title}</span>
            {unreadCount > 0 && (
              <button type="button" className="side-bell-markall" onClick={markAllRead}>
                {labels.markAllRead}
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="side-bell-empty">{labels.empty}</p>
          ) : (
            <div className="side-bell-list">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.href ?? '/app/track'}
                  className={`side-bell-item${n.read_at ? '' : ' unread'}`}
                  onClick={() => handleClick(n)}
                >
                  <span className="side-bell-item-title">{n.title}</span>
                  {n.body && <span className="side-bell-item-body">{n.body}</span>}
                  <span className="side-bell-item-meta">
                    {!n.read_at && <span className="side-bell-dot" />}
                    <time dateTime={n.created_at}>{relDate(n.created_at, 'en')}</time>
                  </span>
                </Link>
              ))}
            </div>
          )}
          {notifications.length > 0 && (
            <div className="side-bell-footer">
              <button type="button" onClick={markAllRead}>
                {labels.markAllRead}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
