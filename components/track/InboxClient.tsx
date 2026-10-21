'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatWhenShort, SNOOZE_PRESETS, snoozeAt, type SnoozePreset } from '@/lib/track-snooze';
import { Popover } from './InlineEditors';
import { relDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

type NotificationType =
  | 'mention'
  | 'assigned'
  | 'status_change'
  | 'issue_update'
  | 'comment'
  | 'subtask'
  | 'relation'
  | 'track_reminder';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  meta: string;
  snoozed_until?: string | null;
}

interface InboxClientProps {
  locale: string;
  labels: {
    title: string;
    all: string;
    mentions: string;
    assigned: string;
    updates: string;
    empty: string;
    emptyBody: string;
    markAllRead: string;
    loadMore: string;
    markRead: string;
    unread: string;
    loading: string;
    loadError: string;
    retry: string;
    someone: string;
    mentionedYou: string;
    assignedYou: string;
    commentedOn: string;
    changedStatus: string;
    updatedIssue: string;
  };
}

const PAGE = 25;

const TABS = [
  { key: 'all', types: undefined as NotificationType[] | undefined },
  { key: 'mentions', types: ['mention'] as NotificationType[] },
  { key: 'assigned', types: ['assigned'] as NotificationType[] },
  {
    key: 'updates',
    types: ['status_change', 'issue_update', 'comment', 'subtask', 'relation', 'track_reminder'] as NotificationType[],
  },
  // Pospuestos: vuelven a la bandeja como no leídos al vencer el plazo.
  { key: 'snoozed', types: undefined as NotificationType[] | undefined },
] as const;

const SNOOZE_LABEL: Record<SnoozePreset, 'inboxSnooze.hour' | 'inboxSnooze.tomorrow' | 'inboxSnooze.nextWeek'> = {
  hour: 'inboxSnooze.hour',
  tomorrow: 'inboxSnooze.tomorrow',
  nextWeek: 'inboxSnooze.nextWeek',
};

type TabKey = (typeof TABS)[number]['key'];

function parseMeta(meta: string): Record<string, string> {
  try {
    const parsed = JSON.parse(meta);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Bandeja de Track: menciones, asignaciones y cambios, con filtro por tipo. */
export default function InboxClient({ locale, labels }: InboxClientProps) {
  const tr = useTranslations('track');
  const [tab, setTab] = useState<TabKey>('all');
  const [snoozeError, setSnoozeError] = useState(false);
  const [rows, setRows] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(
    async (reset: boolean) => {
      const seq = ++request.current;
      setLoading(true);
      setError(false);
      const active = TABS.find((t) => t.key === tab)!;
      const nextPage = reset ? 1 : page;
      const params = new URLSearchParams({ limit: String(PAGE), page: String(nextPage) });
      active.types?.forEach((type) => params.append('type', type));
      if (active.key === 'snoozed') params.set('snoozed', '1');
      const res = await fetch(`/api/notifications?${params.toString()}`).catch(() => null);
      if (seq !== request.current) return;
      if (res?.ok) {
        const data = (await res.json()) as { rows: Notification[] };
        const newRows = data.rows ?? [];
        setRows((prev) => (reset ? newRows : [...prev, ...newRows]));
        setHasMore(newRows.length === PAGE);
        setPage(nextPage + 1);
      } else {
        setError(true);
      }
      setLoading(false);
    },
    [tab, page],
  );

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function markRead(id: string) {
    const res = await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => null);
    if (res?.ok) {
      setRows((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    }
  }

  // Posponer (o traer de vuelta con null): sale de la lista actual.
  async function snooze(id: string, until: Date | null) {
    setSnoozeError(false);
    const res = await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snoozeUntil: until ? until.toISOString() : null }),
    }).catch(() => null);
    if (!res?.ok) {
      setSnoozeError(true);
      return;
    }
    setRows((prev) => prev.filter((n) => n.id !== id));
  }

  async function markAllRead() {
    const res = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readAll: true }),
    }).catch(() => null);
    if (res?.ok) {
      const now = new Date().toISOString();
      setRows((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    }
  }

  function actionText(n: Notification, meta: Record<string, string>): string {
    const actor = meta.actorName ?? labels.someone;
    const identifier = meta.issueIdentifier ?? '';
    const fill = (tpl: string) => tpl.replace('{actor}', actor).replace('{identifier}', identifier);
    switch (n.type) {
      case 'mention':
        return fill(labels.mentionedYou);
      case 'assigned':
        return fill(labels.assignedYou);
      case 'comment':
        return fill(labels.commentedOn);
      case 'status_change':
        return fill(labels.changedStatus);
      case 'issue_update':
        return fill(labels.updatedIssue);
      case 'track_reminder':
        return tr('inboxSnooze.reminderFor', { identifier });
      default:
        return n.title;
    }
  }

  const firstLoad = loading && rows.length === 0;

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length].key;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="ui-page">
      <PageHeader
        title={labels.title}
        actions={
          rows.length > 0 ? (
            <button type="button" className="btn" onClick={() => void markAllRead()}>
              {labels.markAllRead}
            </button>
          ) : null
        }
      />

      <div className="ui-tabs" role="tablist" aria-label={labels.title}>
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[t.key] = el;
            }}
            type="button"
            role="tab"
            className="ui-tab"
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.key === 'snoozed' ? tr('inboxSnooze.tab') : labels[t.key]}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-busy={loading || undefined}>
        {firstLoad ? (
          <div className="ui-loading-stack">
            <span className="sr-only" role="status">
              {labels.loading}
            </span>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="ui-skeleton ui-skeleton-row" />
            ))}
          </div>
        ) : error && rows.length === 0 ? (
          <EmptyState
            quiet
            title={labels.loadError}
            action={
              <button type="button" className="btn btn-primary" onClick={() => void load(true)}>
                {labels.retry}
              </button>
            }
          />
        ) : rows.length === 0 ? (
          tab === 'snoozed' ? (
            <EmptyState quiet title={tr('inboxSnooze.empty')} body={tr('inboxSnooze.emptyBody')} />
          ) : (
            <EmptyState quiet title={labels.empty} body={labels.emptyBody} />
          )
        ) : (
          <ul className="track-inbox-list">
            {rows.map((n) => {
              const meta = parseMeta(n.meta);
              const unread = !n.read_at;
              return (
                <li key={n.id} className={`track-inbox-item${unread ? ' is-unread' : ''}`}>
                  {unread ? (
                    <span className="track-inbox-mark" title={labels.unread}>
                      <span className="sr-only">{labels.unread}</span>
                    </span>
                  ) : (
                    <span className="track-inbox-mark is-read" aria-hidden />
                  )}
                  <Link href={n.href ?? '/app/track'} className="track-inbox-link">
                    <span className="track-inbox-text">{actionText(n, meta)}</span>
                    {meta.projectName && <span className="track-inbox-project">{meta.projectName}</span>}
                  </Link>
                  {tab === 'snoozed' && n.snoozed_until ? (
                    <time className="track-inbox-time" dateTime={n.snoozed_until}>
                      {tr('inboxSnooze.until', { when: formatWhenShort(n.snoozed_until, locale) })}
                    </time>
                  ) : (
                    <time className="track-inbox-time" dateTime={n.created_at}>
                      {relDate(n.snoozed_until ?? n.created_at, locale)}
                    </time>
                  )}
                  {tab === 'snoozed' ? (
                    <button type="button" className="btn btn-ghost btn-sm track-inbox-snooze" onClick={() => void snooze(n.id, null)}>
                      {tr('inboxSnooze.unsnooze')}
                    </button>
                  ) : (
                    <Popover ariaLabel={tr('inboxSnooze.snooze')} className="btn btn-ghost btn-sm track-inbox-snooze" width={240} trigger={tr('inboxSnooze.snooze')}>
                      {(close) =>
                        SNOOZE_PRESETS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            role="menuitem"
                            className="track-menu-item"
                            onClick={() => {
                              close();
                              void snooze(n.id, snoozeAt(p, new Date()));
                            }}
                          >
                            <span className="track-menu-label">{tr(SNOOZE_LABEL[p])}</span>
                            <span className="track-menu-meta">{formatWhenShort(snoozeAt(p, new Date()).toISOString(), locale)}</span>
                          </button>
                        ))
                      }
                    </Popover>
                  )}
                  {unread && tab !== 'snoozed' ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void markRead(n.id)}>
                      {labels.markRead}
                    </button>
                  ) : (
                    <span className="track-inbox-spacer" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {snoozeError && (
          <p className="ui-error" role="alert">
            {tr('inboxSnooze.error')}
          </p>
        )}
        {error && rows.length > 0 && (
          <p className="ui-error" role="alert">
            {labels.loadError}
          </p>
        )}
        {hasMore && rows.length > 0 && (
          <div className="track-pagination">
            <button type="button" className="btn btn-sm" onClick={() => void load(false)} aria-busy={loading || undefined}>
              {labels.loadMore}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
