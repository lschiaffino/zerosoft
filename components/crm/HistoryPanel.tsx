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
      <section className="panel">
        <p className="section-label">{labels.title}</p>
        <p className="muted">…</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="section-label">{labels.title}</p>
      {events.length === 0 ? (
        <p className="muted">{labels.empty}</p>
      ) : (
        <ul className="history-list">
          {events.map((e) => {
            const f = fieldLabel(e.field);
            const oldV = formatValue(e.field, e.oldValue);
            const newV = formatValue(e.field, e.newValue);
            return (
              <li key={e.id} className="history-row">
                <span className="history-field">{f}</span>
                <span className="history-change">
                  <span className="history-value">{oldV}</span>
                  <span className="history-arrow"> → </span>
                  <span className="history-value">{newV}</span>
                </span>
                <span className="history-meta muted">
                  {e.actorEmail ? `${e.actorEmail} · ` : ''}
                  {formatDate(e.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
