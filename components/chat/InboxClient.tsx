'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatConversationListRow } from '@/lib/chat-data';
import ConversationList from './ConversationList';

interface InboxClientProps {
  widgetIds: string[];
  currentUserId: string;
}

type FilterTab = 'all' | 'open' | 'closed' | 'unassigned' | 'mine';

const PAGE_SIZE = 25;

export default function InboxClient({ widgetIds, currentUserId }: InboxClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();

  const [tab, setTab] = useState<FilterTab>('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ChatConversationListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(() => {
    const base: Record<string, string> = {};
    if (widgetIds.length > 0) base.widgetIds = widgetIds.join(',');
    if (q.trim()) base.q = q.trim();
    if (tab === 'open') base.status = 'open';
    if (tab === 'closed') base.status = 'closed';
    if (tab === 'unassigned') base.assignedTo = 'unassigned';
    if (tab === 'mine') base.assignedTo = currentUserId;
    return base;
  }, [tab, q, widgetIds, currentUserId]);

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
    }
  }

  useEffect(() => {
    fetchRows(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: t('inbox.filters.all') },
    { key: 'open', label: t('inbox.filters.open') },
    { key: 'closed', label: t('inbox.filters.closed') },
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
              onClick={() => setTab(tItem.key)}
            >
              {tItem.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="input chat-inbox-search"
          placeholder={t('inbox.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <p className="chat-inbox-error">{error}</p>}

      <section className="panel chat-inbox-panel">
        <ConversationList
          conversations={rows}
          emptyTitle={t('inbox.empty')}
        />
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
