'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
  EMPTY_INBOX_FILTER,
  inboxFilterCount,
  inboxFilterParams,
  inboxGroupKey,
  parseInboxFilter,
  type InboxFilter,
  type InboxKind,
} from '@/lib/notification-inbox-filter';
import type { InboxFacets } from '@/lib/notification-inbox';
import InboxFilters from './InboxFilters';
import { Link } from '@/i18n/navigation';
import { formatWhenShort, SNOOZE_PRESETS, snoozeAt, type SnoozePreset } from '@/lib/track-snooze';
import { Popover } from './InlineEditors';
import { relDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { notificationTitle, type NotificationTextLabels } from '@/lib/notification-text';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/components/app/NotificationBell';

type NotificationType =
  | 'mention'
  | 'assigned'
  | 'status_change'
  | 'issue_update'
  | 'comment'
  | 'subtask'
  | 'relation'
  | 'track_reminder'
  | 'project_update';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  meta: string;
  source_type?: string | null;
  snoozed_until?: string | null;
  /** Lo que agrega /api/notifications/inbox para agrupar. */
  kind?: InboxKind;
  projectId?: string | null;
  projectName?: string | null;
  team?: string | null;
}

/** Filtro, orden y agrupado guardados por persona en este navegador (la URL manda si trae alguno). */
const VIEW_KEY = 'zs:track-inbox-view';
const FILTER_PARAMS = ['read', 'kind', 'project', 'team', 'from', 'order', 'group'];

function readSavedFilter(): InboxFilter | null {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    return raw ? parseInboxFilter(new URLSearchParams(raw)) : null;
  } catch {
    return null;
  }
}

function saveFilter(f: InboxFilter) {
  try {
    const qs = inboxFilterParams(f).toString();
    if (qs) window.localStorage.setItem(VIEW_KEY, qs);
    else window.localStorage.removeItem(VIEW_KEY);
  } catch {
    /* sin storage: queda en la URL */
  }
}

/** La URL refleja el filtro (se puede compartir y sobrevive a recargar) sin navegar. */
function writeUrl(f: InboxFilter) {
  const url = new URL(window.location.href);
  FILTER_PARAMS.forEach((k) => url.searchParams.delete(k));
  inboxFilterParams(f).forEach((v, k) => url.searchParams.append(k, v));
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
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
    types: ['status_change', 'issue_update', 'comment', 'subtask', 'relation', 'track_reminder', 'project_update'] as NotificationType[],
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

/** La campana del sidebar recarga su conteo (pospuestos y leídos dejan de contar). */
function notifyChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/** Bandeja de Track: menciones, asignaciones y cambios, con filtro por tipo. */
export default function InboxClient({ locale, labels }: InboxClientProps) {
  const tr = useTranslations('track');
  const tp = useTranslations('trackPlanning');
  const tTriage = useTranslations('trackTriage');
  const [tab, setTab] = useState<TabKey>('all');
  const [snoozeError, setSnoozeError] = useState(false);
  const [rows, setRows] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<InboxFilter>(() => parseInboxFilter(new URLSearchParams(searchParams?.toString() ?? '')));
  const [facets, setFacets] = useState<InboxFacets | null>(null);
  // Hasta mirar lo guardado no se pide nada (si no, la primera lista sería la sin filtro).
  const [ready, setReady] = useState(false);
  const filterKey = inboxFilterParams(filter).toString();

  useEffect(() => {
    const fromUrl = FILTER_PARAMS.some((k) => searchParams?.has(k));
    if (!fromUrl) {
      const saved = readSavedFilter();
      if (saved && inboxFilterParams(saved).toString()) {
        setFilter(saved);
        writeUrl(saved);
      }
    } else {
      saveFilter(filter);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeFilter = (next: InboxFilter) => {
    setFilter(next);
    saveFilter(next);
    writeUrl(next);
  };

  const load = useCallback(
    async (reset: boolean) => {
      const seq = ++request.current;
      setLoading(true);
      setError(false);
      const active = TABS.find((t) => t.key === tab)!;
      const nextPage = reset ? 1 : page;
      const params = inboxFilterParams(filter);
      params.set('limit', String(PAGE));
      params.set('page', String(nextPage));
      active.types?.forEach((type) => params.append('type', type));
      if (active.key === 'snoozed') params.set('snoozed', '1');
      const res = await fetch(`/api/notifications/inbox?${params.toString()}`).catch(() => null);
      if (seq !== request.current) return;
      if (res?.ok) {
        const data = (await res.json()) as { rows: Notification[]; hasMore: boolean; facets: InboxFacets };
        const newRows = data.rows ?? [];
        setRows((prev) => (reset ? newRows : [...prev, ...newRows]));
        setHasMore(Boolean(data.hasMore));
        setFacets(data.facets ?? null);
        setPage(nextPage + 1);
      } else {
        setError(true);
      }
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, page, filterKey],
  );

  useEffect(() => {
    if (!ready) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterKey, ready]);

  async function markRead(id: string) {
    const res = await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => null);
    if (res?.ok) {
      setRows((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
      notifyChanged();
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
    notifyChanged();
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
      notifyChanged();
    }
  }

  const textLabels: NotificationTextLabels = {
    someone: labels.someone,
    untitled: tr('notifications.untitled'),
    mentionedYou: labels.mentionedYou,
    assignedYou: labels.assignedYou,
    commentedOn: labels.commentedOn,
    changedStatus: labels.changedStatus,
    updatedIssue: labels.updatedIssue,
    reminderFor: tr.raw('inboxSnooze.reminderFor') as string,
    planUpdate: tp.raw('notify.planUpdate') as string,
    planComment: tp.raw('notify.planComment') as string,
    planReminder: tp.raw('notify.planReminder') as string,
    docMention: tr.raw('notifications.docMention') as string,
    docCommentMention: tr.raw('notifications.docCommentMention') as string,
    docCommentReply: tr.raw('notifications.docCommentReply') as string,
    docShared: tr.raw('notifications.docShared') as string,
    noteAccessRequest: tr.raw('notifications.noteAccessRequest') as string,
    noteTaskAssigned: tr.raw('notifications.noteTaskAssigned') as string,
    noteTaskDue: tr.raw('notifications.noteTaskDue') as string,
    noteTransfer: tr.raw('notifications.noteTransfer') as string,
    docConflict: tr.raw('notifications.docConflict') as string,
    boardMention: tr.raw('notifications.boardMention') as string,
    boardReply: tr.raw('notifications.boardReply') as string,
    trackKinds: {
      triage_owner: tTriage.raw('notifications.triage_owner') as string,
      sla_risk: tTriage.raw('notifications.sla_risk') as string,
      sla_breach: tTriage.raw('notifications.sla_breach') as string,
      agent_update: tTriage.raw('notifications.agent_update') as string,
    },
    groupsMention: tr.raw('notifications.groupsMention') as string,
    groupsAssigned: tr.raw('notifications.groupsAssigned') as string,
    groupsAutoAssigned: tr.raw('notifications.groupsAutoAssigned') as string,
    chatMessage: tr.raw('notifications.chatMessage') as string,
  };

  const firstLoad = loading && rows.length === 0;
  const filtered = inboxFilterCount(filter) > 0;
  // Agrupado (Display): las filas ya llegan ordenadas por grupo; acá se cortan en secciones.
  const grouped = tab !== 'snoozed' && filter.group !== 'none';
  const groupLabel = (n: Notification): string => {
    if (filter.group === 'kind') return tr(`inbox.kinds.${n.kind ?? 'other'}`);
    if (filter.group === 'project') return n.projectName ?? tr('inbox.filter.noProject');
    return n.team ?? tr('inbox.filter.noTeam');
  };
  const groups: Array<{ key: string; label: string; rows: Notification[] }> = [];
  if (grouped) {
    for (const n of rows) {
      const key = inboxGroupKey({ kind: n.kind ?? 'other', projectId: n.projectId ?? null, team: n.team ?? null }, filter.group);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(n);
      else groups.push({ key, label: groupLabel(n), rows: [n] });
    }
  }

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length].key;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const renderRow = (n: Notification) => {
    const meta = parseMeta(n.meta);
    const unread = !n.read_at;
    return (
      <li key={n.id} className={`track-inbox-item${unread ? ' is-unread' : ''}`} data-testid="track-inbox-item" data-id={n.id} data-kind={n.kind} data-read={unread ? 'false' : 'true'}>
        {unread ? (
          <span className="track-inbox-mark" title={labels.unread}>
            <span className="sr-only">{labels.unread}</span>
          </span>
        ) : (
          <span className="track-inbox-mark is-read" aria-hidden />
        )}
        <Link href={n.href ?? '/app/track'} className="track-inbox-link">
          <span className="track-inbox-text">{notificationTitle(n, textLabels)}</span>
          {n.source_type === 'robot' && n.body && <span className="track-inbox-body">{n.body}</span>}
          {meta.projectName && <span className="track-inbox-project">{meta.projectName}</span>}
        </Link>
        {tab === 'snoozed' && n.snoozed_until ? (
          <time className="track-inbox-time" dateTime={n.snoozed_until}>
            <LocalText>{tr('inboxSnooze.until', { when: formatWhenShort(n.snoozed_until, locale) })}</LocalText>
          </time>
        ) : (
          <time className="track-inbox-time" dateTime={n.created_at}>
            <LocalText>{relDate(n.snoozed_until ?? n.created_at, locale)}</LocalText>
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
                  <span className="track-menu-meta"><LocalText>{formatWhenShort(snoozeAt(p, new Date()).toISOString(), locale)}</LocalText></span>
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

      <InboxFilters filter={filter} onChange={changeFilter} facets={facets} showDisplay={tab !== 'snoozed'} />

      <div role="tabpanel" aria-busy={loading || undefined} data-testid="track-inbox-panel">
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
          filtered ? (
            <EmptyState
              quiet
              title={tr('inbox.filter.emptyTitle')}
              body={tr('inbox.filter.emptyBody')}
              action={
                <button type="button" className="btn" onClick={() => changeFilter({ ...EMPTY_INBOX_FILTER, order: filter.order, group: filter.group })} data-testid="track-inbox-empty-clear">
                  {tr('filters.clear')}
                </button>
              }
            />
          ) : tab === 'snoozed' ? (
            <EmptyState quiet title={tr('inboxSnooze.empty')} body={tr('inboxSnooze.emptyBody')} />
          ) : (
            <EmptyState quiet title={labels.empty} body={labels.emptyBody} />
          )
        ) : grouped ? (
          groups.map((g, i) => (
            <section key={g.key} className="track-inbox-group" aria-labelledby={`track-inbox-group-${i}`} data-testid="track-inbox-group" data-group={g.key}>
              <h2 className="track-inbox-group-head" id={`track-inbox-group-${i}`}>
                <span className="track-inbox-group-name">{g.label}</span>
                <span className="track-inbox-group-count">{g.rows.length}</span>
              </h2>
              <ul className="track-inbox-list">{g.rows.map(renderRow)}</ul>
            </section>
          ))
        ) : (
          <ul className="track-inbox-list">{rows.map(renderRow)}</ul>
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
