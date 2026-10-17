'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { EventTypeWithRules } from '@/lib/calendar';
import PublicBookingPage, { BookingInfo } from './PublicBookingPage';
import type { PublicBrand } from './cal-utils';

interface Props {
  token: string;
  locale: string;
  eventType: EventTypeWithRules;
  weekStart: number;
  brand: PublicBrand;
  /** Máximo de días para reservar (regla del evento o del workspace). */
  maxFutureDays?: number;
  booking: {
    startsAt: string;
    endsAt: string;
    timezone: string;
    status: string;
    name: string;
    email: string;
  };
  /** Vuelve de Stripe Checkout con el pago hecho. */
  paidNotice?: boolean;
}

/** Página del invitado para ver, cancelar o reprogramar su reserva (sin cuenta). */
export default function ManageBooking({ token, locale, eventType, weekStart, brand, maxFutureDays, booking, paidNotice = false }: Props) {
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
        brand={brand}
        maxFutureDays={maxFutureDays}
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

  const tz = booking.timezone;
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(
    new Date(booking.startsAt),
  );
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const range = `${time.format(new Date(booking.startsAt))} – ${time.format(new Date(booking.endsAt))}`;
  const cancelled = mode === 'cancelled';

  return (
    <div className="bk" style={{ '--bk': brand.color, '--bk-on': brand.on } as CSSProperties}>
      <div className="bk-card">
        <BookingInfo
          logoUrl={brand.logoUrl}
          hostName={brand.name}
          title={eventType.title}
          meta={[
            { icon: 'clock', text: t('booking.minutes', { n: eventType.duration_min }) },
            ...(eventType.location ? [{ icon: 'pin' as const, text: eventType.location }] : []),
          ]}
        />
        <div className="bk-main">
          <section className="bk-done" aria-labelledby="bk-manage-title">
            <h2 id="bk-manage-title" className="bk-h2">
              {t('manage.title')}
            </h2>
            <dl className="bk-summary">
              <div>
                <dt>{t('booking.when')}</dt>
                <dd className={cancelled ? 'bk-struck' : undefined}>
                  {date}
                  <br />
                  <span className="data">{range}</span> <span className="bk-muted">{tz}</span>
                </dd>
              </div>
              <div>
                <dt>{t('booking.who')}</dt>
                <dd>
                  {booking.name}
                  <br />
                  <span className="bk-muted">{booking.email}</span>
                </dd>
              </div>
            </dl>

            {paidNotice && booking.status === 'confirmed' && <p className="bk-status bk-status-ok">{t('manage.paid')}</p>}

            {cancelled ? (
              <p className="bk-status">{t('manage.cancelled')}</p>
            ) : booking.status === 'pending' ? (
              <p className="bk-status">{t('manage.pending')}</p>
            ) : past ? (
              <p className="bk-status">{t('manage.past')}</p>
            ) : mode === 'cancel' ? (
              <form className="bk-form" onSubmit={cancel}>
                <div className="ui-field">
                  <label className="label" htmlFor="bk-reason">
                    {t('manage.cancelReason')}
                  </label>
                  <textarea id="bk-reason" className="textarea" rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                </div>
                {error && (
                  <p className="ui-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="bk-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>
                    {t('manage.keep')}
                  </button>
                  <button type="submit" className="btn btn-primary btn-danger" aria-busy={busy || undefined}>
                    {t('manage.cancelConfirm')}
                  </button>
                </div>
              </form>
            ) : (
              <div className="bk-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setMode('cancel')}>
                  {t('manage.cancel')}
                </button>
                <button type="button" className="btn bk-cta" onClick={() => setMode('reschedule')}>
                  {t('manage.reschedule')}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
