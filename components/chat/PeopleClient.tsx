'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatVisitorListRow } from '@/lib/chat-data';
import { formatTimeAgo, formatDateTime } from '@/lib/datetime';
import EmptyState from '@/components/ui/EmptyState';

interface PeopleClientProps {
  widgetIds: string[];
}

const PAGE_SIZE = 25;

/** Personas que escribieron por algún widget: tabla densa con búsqueda. */
export default function PeopleClient({ widgetIds }: PeopleClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [rows, setRows] = useState<ChatVisitorListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const filters = useMemo(() => {
    const base: Record<string, string> = {};
    if (widgetIds.length > 0) base.widgetIds = widgetIds.join(',');
    if (debouncedQ) base.q = debouncedQ;
    return base;
  }, [debouncedQ, widgetIds]);

  async function fetchRows(offset: number, append: boolean) {
    const seq = ++requestSeq.current;
    if (widgetIds.length === 0) {
      setRows([]);
      setTotal(0);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ ...filters, limit: String(PAGE_SIZE), offset: String(offset) });
      const res = await fetch(`/api/chat/visitors?${params.toString()}`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { rows: ChatVisitorListRow[]; total: number };
      if (seq !== requestSeq.current) return;
      setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
      setTotal(data.total);
    } catch {
      if (seq === requestSeq.current) setError(true);
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }

  useEffect(() => {
    void fetchRows(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  return (
    <div className="ui-page">
      <div className="chat-toolbar">
        <input
          type="search"
          className="input chat-toolbar-search"
          placeholder={t('people.search')}
          aria-label={t('people.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loaded && !error && (
          <span className="chat-toolbar-count">{t('people.count', { count: total })}</span>
        )}
      </div>

      {error ? (
        <div className="chat-load-error" role="alert">
          <p>{t('errors.loadFailed')}</p>
          <button type="button" className="btn btn-sm" onClick={() => fetchRows(0, false)}>
            {t('common.retry')}
          </button>
        </div>
      ) : !loaded ? (
        <div className="ui-loading-stack" aria-label={t('common.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        debouncedQ ? (
          <EmptyState quiet title={t('people.empty')} product="chat" />
        ) : (
          <EmptyState
            title={t('people.emptyTitle')}
            body={t('people.emptyBody')}
            action={{ label: t('people.emptyAction'), href: '/app/chat/widgets' }}
            product="chat"
          />
        )
      ) : (
        <div className="table-wrap chat-stack" aria-busy={loading}>
          <table className="table">
            <caption className="sr-only">{t('people.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('visitorPanel.name')}</th>
                <th scope="col">{t('visitorPanel.email')}</th>
                <th scope="col" className="num">
                  {t('overview.conversations')}
                </th>
                <th scope="col">{t('people.lastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link href={`/app/chat/people/${v.id}`} className="cell-link">
                      {v.name || v.email || t('conversation.anonymous')}
                    </Link>
                  </td>
                  <td data-label={t('visitorPanel.email')}>
                    {v.email ? <span className="data">{v.email}</span> : <span className="chat-quiet">{t('people.noEmail')}</span>}
                  </td>
                  <td className="num data" data-label={t('overview.conversations')}>
                    {v.conversation_count}
                  </td>
                  <td data-label={t('people.lastSeen')}>
                    {v.last_conversation_at ? (
                      <time suppressHydrationWarning dateTime={v.last_conversation_at} title={formatDateTime(v.last_conversation_at, locale)}>
                        {formatTimeAgo(v.last_conversation_at, locale)}
                      </time>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loaded && !error && rows.length < total && (
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fetchRows(rows.length, true)}
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {t('inbox.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
