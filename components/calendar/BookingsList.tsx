'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CalendarBookingRowWithEvent } from '@/lib/calendar';

type Filter = 'upcoming' | 'past' | 'cancelled';

interface Props {
  bookings: CalendarBookingRowWithEvent[];
  locale: string;
}

function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function BookingsList({ bookings, locale }: Props) {
  const t = useTranslations('calendar');
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rows, setRows] = useState(bookings);
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = new Date().toISOString();
    return rows.filter((b) => {
      if (filter === 'cancelled') return b.status === 'cancelled';
      if (filter === 'past') return b.status === 'confirmed' && b.starts_at < now;
      return b.status === 'confirmed' && b.starts_at >= now;
    });
  }, [rows, filter]);

  async function cancel(id: string) {
    if (!confirm(t('booking.cancelConfirm'))) return;
    setBusy(id);
    const res = await fetch(`/api/calendar/bookings/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => null);
    setBusy(null);
    if (res && res.ok) {
      setRows((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: 'cancelled' } : b)),
      );
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  return (
    <div className="bookings-list">
      <div className="booking-filters">
        {(['upcoming', 'past', 'cancelled'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-small${filter === f ? ' btn-solid' : ' btn-ghost'}`}
            onClick={() => setFilter(f)}
          >
            {t(`booking.filter.${f}`)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-inline">
          <p className="muted">{t('booking.empty')}</p>
        </div>
      ) : (
        <ul className="booking-cards">
          {filtered.map((b) => (
            <li key={b.id} className="panel booking-card-item">
              <div className="booking-card-main">
                <div className="booking-card-guest">
                  <p className="booking-card-name">{b.invitee_name}</p>
                  <p className="booking-card-email muted">{b.invitee_email}</p>
                </div>
                <div className="booking-card-event">
                  <p className="booking-card-event-title">{b.event_type_title}</p>
                  <p className="muted">
                    {b.event_type_duration_min} {t('eventTypes.minutes')}
                  </p>
                </div>
                <div className="booking-card-time">
                  <p>{formatDateTime(b.starts_at, locale)}</p>
                  <p className="muted">{b.timezone}</p>
                  {b.meeting_url && b.status === 'confirmed' && (
                    <a className="mono" href={b.meeting_url} target="_blank" rel="noreferrer">
                      {t('bookings.join')}
                    </a>
                  )}
                  {b.rescheduled_from && <p className="muted">{t('bookings.rescheduled')}</p>}
                </div>
                <div className="booking-card-status">
                  <span className={`badge booking-status-${b.status}`}>{t(`booking.status.${b.status}`)}</span>
                </div>
                <div className="booking-card-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => toggleExpanded(b.id)}
                  >
                    {expanded === b.id ? t('common.hide') : t('common.view')}
                  </button>
                  {b.status === 'confirmed' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small btn-danger"
                      onClick={() => cancel(b.id)}
                      disabled={busy === b.id}
                    >
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              </div>

              {expanded === b.id && (
                <div className="booking-card-detail">
                  {b.host_email && (
                    <p className="muted">
                      {t('booking.host')}: {b.host_name ?? b.host_email}
                    </p>
                  )}
                  {b.answers && b.answers !== '{}' && (
                    <div className="booking-answers">
                      <p className="prop-label">{t('booking.answers')}</p>
                      <pre>{b.answers}</pre>
                    </div>
                  )}
                  <p className="muted mono">ID: {b.id}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
