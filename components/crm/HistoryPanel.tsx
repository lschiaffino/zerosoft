'use client';

import { useEffect, useState } from 'react';

interface HistoryEvent {
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
  actorEmail: string;
  createdAt: string;
}

interface HistoryPanelProps {
  entity: 'contact' | 'company' | 'deal';
  entityId: string;
  locale: string;
  labels: {
    title: string;
    empty: string;
    fields: Record<string, string>;
    values?: Record<string, Record<string, string>>;
  };
}

export default function HistoryPanel({ entity, entityId, locale, labels }: HistoryPanelProps) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crm/history?entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(entityId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setEvents(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entity, entityId]);

  const fieldLabel = (field: string) => {
    if (field.startsWith('custom.')) {
      return field.slice(7);
    }
    return labels.fields[field] || field;
  };

  const formatValue = (field: string, value: string) => {
    if (value === '') return '—';
    const map = labels.values?.[field];
    return map?.[value] ?? value;
  };

  const formatDate = (at: string) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(`${at.replace(' ', 'T')}Z`));
    } catch {
      return at;
    }
  };

  if (events === null) {
    return (
      <div className="ui-loading-stack" aria-busy="true" aria-label={labels.title}>
        <span className="ui-skeleton ui-skeleton-row" />
        <span className="ui-skeleton ui-skeleton-row" />
        <span className="ui-skeleton ui-skeleton-row" />
      </div>
    );
  }

  if (events.length === 0) return <p className="muted">{labels.empty}</p>;

  return (
    <ol className="history-list">
      {events.map((e) => (
        <li key={e.id} className="history-row">
          <span className="history-field">{fieldLabel(e.field)}</span>
          <span className="history-change">
            <span className="history-value is-old">{formatValue(e.field, e.oldValue)}</span>
            <svg className="history-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <span className="history-value">{formatValue(e.field, e.newValue)}</span>
          </span>
          <span className="history-meta">
            {e.actorEmail ? `${e.actorEmail} · ` : ''}
            <time dateTime={e.createdAt}>{formatDate(e.createdAt)}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}
