'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { EventTypeWithRules } from '@/lib/calendar';
import PublicBookingPage from './PublicBookingPage';

interface Props {
  token: string;
  locale: string;
  eventType: EventTypeWithRules;
  weekStart: number;
  booking: {
    startsAt: string;
    endsAt: string;
    timezone: string;
    status: string;
    name: string;
    email: string;
  };
}

function formatRange(start: string, end: string, timezone: string, locale: string): string {
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(start));
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: timezone });
  return `${date} · ${time.format(new Date(start))} – ${time.format(new Date(end))}`;
}

/** Página del invitado para ver, cancelar o reprogramar su reserva (sin cuenta). */
export default function ManageBooking({ token, locale, eventType, weekStart, booking }: Props) {
  const t = useTranslations('calendar');
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule' | 'cancelled'>(
    booking.status === 'cancelled' ? 'cancelled' : 'view',
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const past = new Date(booking.startsAt).getTime() < Date.now();

  if (mode === 'reschedule') {
    return (
      <PublicBookingPage
        eventType={eventType}
        locale={locale}
        weekStart={weekStart}
        reschedule={{ token, name: booking.name, email: booking.email }}
      />
    );
  }

  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/bookings/manage/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: reason.trim() || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setMode('cancelled');
      return;
    }
    setError(t('errors.generic'));
  }

  return (
    <div className="booking-page">
      <div className="booking-card">
        <header className="booking-header">
          <p className="section-label">{t('manage.title')}</p>
          <h1 className="booking-title">{eventType.title}</h1>
        </header>

        <p className={`booking-confirm-time${mode === 'cancelled' ? ' muted' : ''}`}>
          {mode === 'cancelled' && <s>{formatRange(booking.startsAt, booking.endsAt, booking.timezone, locale)}</s>}
          {mode !== 'cancelled' && formatRange(booking.startsAt, booking.endsAt, booking.timezone, locale)}
        </p>
        <p className="booking-confirm-tz muted">{booking.timezone}</p>
        <p className="booking-confirm-detail">
          {booking.name} · {booking.email}
        </p>
        {eventType.location && <p className="booking-confirm-detail muted">{eventType.location}</p>}

        {mode === 'cancelled' ? (
          <p className="booking-confirm-detail">{t('manage.cancelled')}</p>
        ) : past ? (
          <p className="booking-confirm-detail muted">{t('manage.past')}</p>
        ) : mode === 'cancel' ? (
          <form className="booking-form" onSubmit={cancel}>
            <label className="field">
              <span className="prop-label">{t('manage.cancelReason')}</span>
              <textarea className="input textarea" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="booking-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setMode('view')}>
                {t('common.back')}
              </button>
              <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
                {busy ? t('common.saving') : t('manage.cancelConfirm')}
              </button>
            </div>
          </form>
        ) : (
          <div className="booking-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setMode('cancel')}>
              {t('manage.cancel')}
            </button>
            <button type="button" className="btn btn-solid btn-small" onClick={() => setMode('reschedule')}>
              {t('manage.reschedule')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
