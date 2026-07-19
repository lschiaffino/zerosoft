'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';

type NotificationType = 'mention' | 'assigned' | 'status_change' | 'comment' | 'subtask' | 'relation';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  meta: string;
}

interface InboxClientProps {
  locale: string;
  labels: {
    all: string;
    mentions: string;
    assigned: string;
    updates: string;
    empty: string;
    markAllRead: string;
    loadMore: string;
    markRead: string;
    mentionedYou: string;
    assignedYou: string;
    commentedOn: string;
    changedStatus: string;
  };
}

const TABS = [
  { key: 'all', labelKey: 'all' as const, types: undefined as NotificationType[] | undefined },
  { key: 'mentions', labelKey: 'mentions' as const, types: ['mention'] as NotificationType[] },
  { key: 'assigned', labelKey: 'assigned' as const, types: ['assigned'] as NotificationType[] },
  { key: 'updates', labelKey: 'updates' as const, types: ['status_change', 'comment', 'subtask', 'relation'] as NotificationType[] },
];

export default function InboxClient({ locale, labels }: InboxClientProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const [rows, setRows] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (reset = false) => {
      setLoading(true);
      const active = TABS.find((t) => t.key === tab)!;
      const nextPage = reset ? 1 : page;
      const params = new URLSearchParams({ limit: '25', page: String(nextPage) });
      if (active.types) {
        active.types.forEach((t) => params.append('type', t));
      }
      const res = await fetch(`/api/notifications?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { rows: Notification[] };
        const newRows = data.rows ?? [];
        setRows((prev) => (reset ? newRows : [...prev, ...newRows]));
        setHasMore(newRows.length === 25);
        if (reset) setPage(2);
        else setPage((p) => p + 1);
      }
      setLoading(false);
    },
    [tab, page],
  );

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function markRead(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const res = await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    if (res.ok) {
      setRows((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
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
      setRows((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    }
  }

  function parseMeta(meta: string): Record<string, string> {
    try {
      const parsed = JSON.parse(meta);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  function actionText(n: Notification, meta: Record<string, string>): string {
    const actor = meta.actorName ?? 'Someone';
    const identifier = meta.issueIdentifier ?? '';
    switch (n.type) {
      case 'mention':
        return labels.mentionedYou.replace('{actor}', actor).replace('{identifier}', identifier);
      case 'assigned':
        return labels.assignedYou.replace('{actor}', actor).replace('{identifier}', identifier);
      case 'comment':
        return labels.commentedOn.replace('{actor}', actor).replace('{identifier}', identifier);
      case 'status_change':
        return labels.changedStatus.replace('{actor}', actor).replace('{identifier}', identifier);
      default:
        return n.title;
    }
  }

  const tabLabels: Record<(typeof TABS)[number]['labelKey'], string> = {
    all: labels.all,
    mentions: labels.mentions,
    assigned: labels.assigned,
    updates: labels.updates,
  };

  return (
    <div>
      <div className="track-toolbar">
        <div className="track-inbox-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`track-inbox-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {tabLabels[t.labelKey]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-outline" onClick={markAllRead}>
          {labels.markAllRead}
        </button>
      </div>

      <div className="track-inbox-list">
        {rows.length === 0 && !loading ? (
          <div className="track-empty">
            <p className="track-empty-zeros">0</p>
            <p>{labels.empty}</p>
          </div>
        ) : (
          rows.map((n) => {
            const meta = parseMeta(n.meta);
            const unread = !n.read_at;
            return (
              <Link
                key={n.id}
                href={n.href ?? '/app/track'}
                className={`track-inbox-item${unread ? ' unread' : ''}`}
              >
                <div className="track-inbox-item-main">
                  <div className="track-inbox-item-text">{actionText(n, meta)}</div>
                  <div className="track-inbox-item-meta">
                    <span>{meta.projectName}</span>
                    <time dateTime={n.created_at}>{relDate(n.created_at, locale)}</time>
                  </div>
                </div>
                {unread && (
                  <div className="track-inbox-item-actions">
                    <button type="button" onClick={(e) => markRead(e, n.id)}>
                      {labels.markRead}
                    </button>
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>

      {hasMore && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={() => load()} disabled={loading}>
            {labels.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
