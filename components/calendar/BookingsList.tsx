'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { CalendarBookingRowWithEvent } from '@/lib/calendar';

type Status = '' | 'confirmed' | 'pending' | 'cancelled' | 'no_show';

interface Filters {
  q: string;
  status: Status;
  from: string;
  to: string;
}

interface Props {
  bookings: CalendarBookingRowWithEvent[];
  locale: string;
  initialFilters: Filters;
}

type Panel = { id: string; kind: 'reschedule' | 'cancel' } | null;

function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function money(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Respuestas del invitado (JSON) como pares legibles. */
function answerEntries(raw: string): Array<[string, string]> {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
  } catch {
    return [['-', raw]];
  }
}

function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function BookingsList({ bookings, locale, initialFilters }: Props) {
  const t = useTranslations('calendar');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [rows, setRows] = useState(bookings);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  // Filtros en el servidor (búsqueda con debounce); la URL refleja el filtro activo.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const sp = new URLSearchParams();
    if (filters.q.trim()) sp.set('q', filters.q.trim());
    if (filters.status) sp.set('status', filters.status);
    if (filters.from) sp.set('from', filters.from);
    if (filters.to) sp.set('to', filters.to);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await fetch(`/api/calendar/bookings?${sp}`, { signal: ctrl.signal }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as { bookings: CalendarBookingRowWithEvent[] };
        setRows(data.bookings);
      }
      setLoading(false);
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${sp.size ? `?${sp}` : ''}`);
      } catch {
        // sin history (iframes raros): el filtro igual funciona
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [filters]);

  function set<K extends keyof Filters>(k: K, v: Filters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
  }

  function errorText(code: string | undefined): string {
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  }

  async function patchBooking(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/calendar/bookings/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (res && res.ok) {
      const updated = (await res.json()) as Partial<CalendarBookingRowWithEvent>;
      setRows((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
      return true;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    setError(errorText(data?.error));
    return false;
  }

  const now = new Date().toISOString();

  return (
    <div className="bookings-list">
      <div className="cal-bk-filters" role="search">
        <input
          className="input"
          type="search"
          placeholder={t('admin.search')}
          aria-label={t('admin.search')}
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
        />
        <select
          className="select"
          aria-label={t('admin.status')}
          value={filters.status}
          onChange={(e) => set('status', e.target.value as Status)}
        >
          <option value="">{t('admin.allStatuses')}</option>
          {(['confirmed', 'pending', 'cancelled', 'no_show'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`booking.status.${s}`)}
            </option>
          ))}
        </select>
        <label className="cal-bk-date">
          <span className="prop-label">{t('admin.from')}</span>
          <input className="input mono" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="cal-bk-date">
          <span className="prop-label">{t('admin.to')}</span>
          <input className="input mono" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => setFilters({ q: '', status: '', from: '', to: '' })}
        >
          {t('admin.clear')}
        </button>
      </div>
      <p className="muted mono cal-bk-count" aria-live="polite">
        {loading ? t('admin.loading') : t('admin.count', { n: rows.length })}
      </p>
      {notice && <p className="cal-notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      {rows.length === 0 && !loading ? (
        filters.q || filters.status || filters.to ? (
          <p className="muted cal-empty-line">{t('booking.empty')}</p>
        ) : (
          <div className="cal-empty">
            <p className="empty-zeros mono" aria-hidden>
              0 0 0
            </p>
            <h2>{t('bookings.emptyTitle')}</h2>
            <p className="muted">{t('bookings.emptySub')}</p>
            <Link href="/app/calendar/event-types" className="btn btn-solid btn-small">
              {t('bookings.emptyCta')}
            </Link>
          </div>
        )
      ) : (
        <ul className="booking-cards cal-list">
          {rows.map((b) => {
            const started = b.starts_at < now;
            return (
              <li key={b.id} className="booking-card-item">
                <div className="booking-card-main">
                  <div className="booking-card-guest">
                    <p className="booking-card-name">{b.invitee_name}</p>
                    <p className="booking-card-email muted">{b.invitee_email}</p>
                  </div>
                  <div className="booking-card-event">
                    <p className="booking-card-event-title">{b.event_type_title}</p>
                    <p className="muted">
                      {b.event_type_duration_min} {t('eventTypes.minutes')}
                      {b.amount_cents > 0 ? ` · ${money(b.amount_cents, b.currency, locale)}` : ''}
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
                  <p className={`cal-bk-status mono cal-bk-status-${b.status}`}>
                    {t(`booking.status.${b.status}`)}
                    {b.payment_status === 'paid' ? ` · ${t('admin.paid')}` : ''}
                    {b.payment_status === 'refunded' ? ` · ${t('admin.refunded')}` : ''}
                  </p>
                  <div className="booking-card-actions">
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setExpanded((p) => (p === b.id ? null : b.id))}>
                      {expanded === b.id ? t('common.hide') : t('common.view')}
                    </button>
                    {b.status === 'confirmed' && !started && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => setPanel({ id: b.id, kind: 'reschedule' })}
                      >
                        {t('admin.reschedule')}
                      </button>
                    )}
                    {b.status === 'confirmed' && started && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        disabled={busy === b.id}
                        onClick={() => void patchBooking(b.id, { status: 'no_show' })}
                      >
                        {t('admin.noShow')}
                      </button>
                    )}
                    {(b.status === 'confirmed' || b.status === 'pending') && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-small btn-danger"
                        onClick={() => setPanel({ id: b.id, kind: 'cancel' })}
                      >
                        {t('admin.cancel')}
                      </button>
                    )}
                  </div>
                </div>

                {panel?.id === b.id && panel.kind === 'cancel' && (
                  <CancelPanel
                    busy={busy === b.id}
                    onClose={() => setPanel(null)}
                    onConfirm={async (reason) => {
                      if (await patchBooking(b.id, { status: 'cancelled', cancelReason: reason || null })) setPanel(null);
                    }}
                  />
                )}
                {panel?.id === b.id && panel.kind === 'reschedule' && (
                  <ReschedulePanel
                    booking={b}
                    locale={locale}
                    onClose={() => setPanel(null)}
                    onDone={(updated) => {
                      setRows((prev) => prev.map((r) => (r.id === b.id ? { ...r, ...updated } : r)));
                      setPanel(null);
                      setNotice(t('admin.moved'));
                    }}
                    onError={(code) => setError(errorText(code))}
                  />
                )}

                {expanded === b.id && (
                  <div className="booking-card-detail">
                    {b.host_email && (
                      <p className="muted">
                        {t('booking.host')}: {b.host_name ?? b.host_email}
                      </p>
                    )}
                    {b.cancel_reason && (
                      <p className="muted">
                        {t('manage.cancelReason')}: {b.cancel_reason}
                      </p>
                    )}
                    {b.answers && b.answers !== '{}' && (
                      <div className="booking-answers">
                        <p className="prop-label">{t('booking.answers')}</p>
                        <dl className="cal-answers">
                          {answerEntries(b.answers).map(([k, v]) => (
                            <div key={k}>
                              <dt className="mono">{k}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                    <p className="muted mono">ID: {b.id}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CancelPanel({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations('calendar');
  const [reason, setReason] = useState('');
  return (
    <div className="cal-bk-panel">
      <label className="field">
        <span className="prop-label">{t('admin.cancelReason')}</span>
        <textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="cal-bk-panel-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          {t('admin.keep')}
        </button>
        <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => onConfirm(reason.trim())}>
          {t('admin.confirmCancel')}
        </button>
      </div>
    </div>
  );
}

function ReschedulePanel({
  booking,
  locale,
  onClose,
  onDone,
  onError,
}: {
  booking: CalendarBookingRowWithEvent;
  locale: string;
  onClose: () => void;
  onDone: (updated: Partial<CalendarBookingRowWithEvent>) => void;
  onError: (code: string | undefined) => void;
}) {
  const t = useTranslations('calendar');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [date, setDate] = useState(localDay(new Date(Math.max(Date.now(), new Date(booking.starts_at).getTime()))));
  const [slots, setSlots] = useState<Array<{ start: string }> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setSlots(null);
    fetch(`/api/calendar/bookings/${booking.id}/slots?date=${date}&timezone=${encodeURIComponent(tz)}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d: { slots: Array<{ start: string }> }) => alive && setSlots(d.slots))
      .catch(() => alive && setSlots([]));
    return () => {
      alive = false;
    };
  }, [booking.id, date, tz]);

  async function pick(start: string) {
    setBusy(true);
    const res = await fetch(`/api/calendar/bookings/${booking.id}/reschedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start, timezone: tz }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      onDone((await res.json()) as Partial<CalendarBookingRowWithEvent>);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    onError(data?.error);
  }

  return (
    <div className="cal-bk-panel">
      <p className="muted">{t('admin.rescheduleHint')}</p>
      <label className="cal-bk-date">
        <span className="prop-label">{t('admin.pickDate')}</span>
        <input className="input mono" type="date" value={date} min={localDay()} onChange={(e) => setDate(e.target.value)} />
      </label>
      {slots === null ? (
        <p className="muted mono">{t('admin.loading')}</p>
      ) : slots.length === 0 ? (
        <p className="muted">{t('admin.noSlots')}</p>
      ) : (
        <div className="cal-bk-slots">
          {slots.map((s) => (
            <button key={s.start} type="button" className="btn btn-small" disabled={busy} onClick={() => void pick(s.start)}>
              {formatTime(s.start, locale)}
            </button>
          ))}
        </div>
      )}
      <p className="muted mono">{tz}</p>
      <div className="cal-bk-panel-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          {t('admin.keep')}
        </button>
      </div>
    </div>
  );
}
