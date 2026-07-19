'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import type { ChatVisitorListRow } from '@/lib/chat-data';
import { formatTimeAgo, formatDateTime } from '@/lib/datetime';

interface PeopleClientProps {
  widgetIds: string[];
}

const PAGE_SIZE = 25;

function initials(name: string | null, email: string | null): string {
  const base = name || email || '?';
  const parts = base.trim().split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function PeopleClient({ widgetIds }: PeopleClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ChatVisitorListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(() => {
    const base: Record<string, string> = {};
    if (widgetIds.length > 0) base.widgetIds = widgetIds.join(',');
    if (q.trim()) base.q = q.trim();
    return base;
  }, [q, widgetIds]);

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
      const res = await fetch(`/api/chat/visitors?${params.toString()}`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { rows: ChatVisitorListRow[]; total: number };
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

  return (
    <div className="chat-people">
      <div className="chat-people-head">
        <input
          type="text"
          className="input chat-people-search"
          placeholder={t('people.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <p className="chat-inbox-error">{error}</p>}

      <section className="panel chat-people-panel">
        {rows.length === 0 && !loading ? (
          <div className="chat-list-empty">
            <p className="empty-zeros mono" aria-hidden>0 0 0</p>
            <p className="muted">{q.trim() ? t('people.empty') : t('common.empty')}</p>
          </div>
        ) : (
          <ul className="chat-people-list">
            {rows.map((v) => (
              <li key={v.id}>
                <Link href={`/app/chat/people/${v.id}`} className="chat-people-row">
                  <span className="chat-people-avatar">{initials(v.name, v.email)}</span>
                  <div className="chat-people-main">
                    <div className="chat-people-top">
                      <span className="chat-people-name">
                        {v.name || v.email || v.external_id}
                      </span>
                      {v.last_conversation_at && (
                        <span className="chat-people-time mono" title={formatDateTime(v.last_conversation_at, locale)}>
                          {formatTimeAgo(v.last_conversation_at, locale)}
                        </span>
                      )}
                    </div>
                    <div className="chat-people-meta">
                      {v.email && <span className="mono muted">{v.email}</span>}
                      <span className="mono muted">
                        {t('people.conversations', { count: v.conversation_count })}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
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
