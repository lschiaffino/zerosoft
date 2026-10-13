'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useKeyShortcut } from '@/components/app/QuickModal';
import NewWidgetButton from './NewWidgetButton';
import type { ChatConversationListRow } from '@/lib/chat-data';
import ConversationList from './ConversationList';

interface InboxClientProps {
  widgetIds: string[];
  currentUserId: string;
}

type FilterTab = 'all' | 'open' | 'pending' | 'snoozed' | 'resolved' | 'unassigned' | 'mine';

const PAGE_SIZE = 25;

export default function InboxClient({ widgetIds, currentUserId }: InboxClientProps) {
  const t = useTranslations('chat');

  const [tab, setTab] = useState<FilterTab>('open');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [rows, setRows] = useState<ChatConversationListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsCount = useRef(0);
  rowsCount.current = rows.length;

  const filters = useMemo(() => {
    const base: Record<string, string> = {};
    if (widgetIds.length > 0) base.widgetIds = widgetIds.join(',');
    if (q.trim()) base.q = q.trim();
    if (tag) base.tag = tag;
    if (tab === 'open' || tab === 'pending' || tab === 'snoozed' || tab === 'resolved') {
      base.status = tab;
    }
    if (tab === 'unassigned') base.assignedTo = 'unassigned';
    if (tab === 'mine') base.assignedTo = currentUserId;
    return base;
  }, [tab, q, tag, widgetIds, currentUserId]);

  useEffect(() => {
    if (widgetIds.length === 0) return;
    fetch('/api/chat/tags')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: Array<{ tag: string; count: number }> }) => setTags(d.rows ?? []))
      .catch(() => {});
  }, [widgetIds.length]);

  async function fetchRows(offset: number, append: boolean) {
    if (widgetIds.length === 0) {
      setRows([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ ...filters, limit: String(PAGE_SIZE), offset: String(offset) });
      const res = await fetch(`/api/chat/conversations?${params.toString()}`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { rows: ChatConversationListRow[]; total: number };
      setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
      setTotal(data.total);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  useEffect(() => {
    fetchRows(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Las conversaciones nuevas aparecen solas (antes había que recargar).
  // Solo refresca la primera página para no pisar un "Load more".
  useEffect(() => {
    if (widgetIds.length === 0) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible' || rowsCount.current > PAGE_SIZE) return;
      const params = new URLSearchParams({ ...filters, limit: String(PAGE_SIZE), offset: '0' });
      fetch(`/api/chat/conversations?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { rows: ChatConversationListRow[]; total: number } | null) => {
          if (!data) return;
          setRows(data.rows);
          setTotal(data.total);
        })
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [filters, widgetIds.length]);

  useKeyShortcut('/', () => searchRef.current?.focus());

  if (widgetIds.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-zeros mono" aria-hidden>
          0 0 0
        </p>
        <h2>{t('inbox.noWidgetsTitle')}</h2>
        <p className="muted">{t('inbox.noWidgetsSub')}</p>
        <NewWidgetButton shortcut={false} />
      </div>
    );
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'open', label: t('inbox.filters.open') },
    { key: 'pending', label: t('inbox.filters.pending') },
    { key: 'snoozed', label: t('inbox.filters.snoozed') },
    { key: 'resolved', label: t('inbox.filters.resolved') },
    { key: 'all', label: t('inbox.filters.all') },
    { key: 'unassigned', label: t('inbox.filters.unassigned') },
    { key: 'mine', label: t('inbox.filters.mine') },
  ];

  return (
    <div className="chat-inbox">
      <div className="chat-inbox-head">
        <div className="chat-inbox-tabs">
          {tabs.map((tItem) => (
            <button
              key={tItem.key}
              type="button"
              className={`chat-inbox-tab${tab === tItem.key ? ' active' : ''}`}
              aria-pressed={tab === tItem.key}
              onClick={() => setTab(tItem.key)}
            >
              {tItem.label}
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <select
            className="select chat-inbox-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            aria-label={t('tags.filter')}
          >
            <option value="">{t('tags.all')}</option>
            {tags.map((x) => (
              <option key={x.tag} value={x.tag}>
                #{x.tag} ({x.count})
              </option>
            ))}
          </select>
        )}
        <input
          ref={searchRef}
          type="search"
          className="input chat-inbox-search"
          placeholder={t('inbox.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <p className="chat-inbox-error">{error}</p>}

      <section className="chat-inbox-panel" aria-busy={loading}>
        {loaded ? (
          <ConversationList
            conversations={rows}
            emptyTitle={tab === 'open' && !q.trim() ? t('inbox.emptyOpen') : t('inbox.empty')}
          />
        ) : (
          <p className="muted chat-inbox-loading mono">{t('common.loading')}</p>
        )}
      </section>

      {rows.length < total && (
        <div className="chat-inbox-more">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => fetchRows(rows.length, true)}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('inbox.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
