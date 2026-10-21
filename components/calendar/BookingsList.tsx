'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { CalendarBookingRowWithEvent } from '@/lib/calendar';
import { parseUtm } from '@/lib/calendar-redirect';
import { answerText } from '@/lib/calendar-questions';
import { isLocationKind } from '@/lib/calendar-locations';

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
  /** Zona del calendario del workspace: la hora se muestra en esta zona (igual en SSR y en el navegador). */
  timezone: string;
  initialFilters: Filters;
  /** Filtro por defecto (sin parámetros en la URL): desde hoy. Limpiar vuelve a este. */
  defaultFrom: string;
}

type Panel = { id: string; kind: 'reschedule' | 'cancel' | 'decline' } | null;

/** La reserva espera que el anfitrión la confirme (no un pago). */
function awaitingApproval(b: Pick<CalendarBookingRowWithEvent, 'status' | 'approval'>): boolean {
  return b.status === 'pending' && b.approval === 'pending';
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'badge badge-ok',
  pending: 'badge badge-warn',
  cancelled: 'badge',
  no_show: 'badge badge-bad',
};

function formatTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(iso));
}

function money(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Respuestas del invitado (JSON) como [clave, etiqueta, valor] legibles: la
 * etiqueta es la que definió el dueño en el campo (si sigue existiendo) y los
 * sí/no van traducidos.
 */
function answerEntries(raw: string, fieldsRaw: string | null | undefined, bool: { yes: string; no: string }): Array<[string, string, string]> {
  const labels = new Map<string, string>();
  try {
    const fields = JSON.parse(fieldsRaw || '[]') as unknown;
    if (Array.isArray(fields)) {
      for (const f of fields as Array<{ name?: unknown; label?: unknown }>) {
        if (typeof f?.name === 'string' && typeof f.label === 'string' && f.label) labels.set(f.name, f.label);
      }
    }
  } catch {
    // Sin campos legibles: se muestra la clave.
  }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj).map(([k, v]) => [
      k,
      labels.get(k) ?? k,
      answerText(v, bool),
    ]);
  } catch {
    return [['-', '-', raw]];
  }
}

/** Invitados extra de la reserva (JSON de emails). */
function guestList(raw: string | null | undefined): string[] {
  try {
    const list: unknown = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Reservas del anfitrión agrupadas por día (en la zona del calendario):
 * hora, invitado, tipo de evento, estado y acciones en una fila densa. Ver,
 * reprogramar y cancelar se abren en línea debajo de la fila.
 */
export default function BookingsList({ bookings, locale, timezone, initialFilters, defaultFrom }: Props) {
  const t = useTranslations('calendar');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [rows, setRows] = useState(bookings);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
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
      setLoadError(false);
      const res = await fetch(`/api/calendar/bookings?${sp}`, { signal: ctrl.signal }).catch(() => null);
      if (ctrl.signal.aborted) return;
      if (res && res.ok) {
        const data = (await res.json()) as { bookings: CalendarBookingRowWithEvent[] };
        setRows(data.bookings);
      } else {
        setLoadError(true);
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
  }, [filters, reload]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

  /** Confirmar o rechazar una solicitud (el invitado recibe el aviso). */
  async function respond(id: string, decision: 'confirm' | 'decline', reason?: string): Promise<boolean> {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/calendar/bookings/${id}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, reason: reason || undefined }),
    }).catch(() => null);
    setBusy(null);
    if (res && res.ok) {
      const updated = (await res.json()) as Partial<CalendarBookingRowWithEvent>;
      setRows((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
      setNotice(decision === 'confirm' ? t('admin.approved') : t('admin.declined'));
      return true;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    setError(errorText(data?.error));
    return false;
  }

  const now = new Date().toISOString();
  const filtered = !!(filters.q || filters.status || filters.to || filters.from !== defaultFrom);
  const dayHeading = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone });
  const todayKey = dayKey(now, timezone);

  // Grupos por día, en el orden que vino del servidor.
  const groups: Array<{ key: string; label: string; rows: CalendarBookingRowWithEvent[] }> = [];
  for (const b of rows) {
    const key = dayKey(b.starts_at, timezone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(b);
    else {
      const label = dayHeading.format(new Date(b.starts_at));
      groups.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), rows: [b] });
    }
  }

  return (
    <div className="cal-bookings">
      <div className="cal-toolbar" role="search">
        <input
          className="input cal-toolbar-search"
          type="search"
          placeholder={t('admin.search')}
          aria-label={t('admin.search')}
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
        />
        <select className="select" aria-label={t('admin.status')} value={filters.status} onChange={(e) => set('status', e.target.value as Status)}>
          <option value="">{t('admin.allStatuses')}</option>
          {(['confirmed', 'pending', 'cancelled', 'no_show'] as const).map((s) => (
            <option key={s} value={s}>
              {s === 'pending' ? t('admin.pendingFilter') : t(`booking.status.${s}`)}
            </option>
          ))}
        </select>
        <div className="ui-input-group cal-toolbar-date">
          <span className="ui-addon">{t('admin.from')}</span>
          <input className="input data" type="date" aria-label={t('admin.from')} value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="ui-input-group cal-toolbar-date">
          <span className="ui-addon">{t('admin.to')}</span>
          <input className="input data" type="date" aria-label={t('admin.to')} value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        {filtered && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ q: '', status: '', from: defaultFrom, to: '' })}>
            {t('admin.clear')}
          </button>
        )}
        <p className="cal-toolbar-count" aria-live="polite">
          {loading ? t('admin.loading') : t('admin.count', { n: rows.length })}
        </p>
      </div>

      {notice && (
        <div className="ui-toasts" role="status" aria-live="polite">
          <div className="ui-toast">{notice}</div>
        </div>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {loadError ? (
        <EmptyState
          quiet
          title={t('admin.loadErrorTitle')}
          body={t('admin.loadErrorBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setReload((n) => n + 1)}>
              {t('admin.retry')}
            </button>
          }
        />
      ) : loading && rows.length === 0 ? (
        <div className="ui-loading-stack" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            quiet
            title={t('booking.empty')}
            body={t('bookings.emptyFiltered')}
            action={
              <button type="button" className="btn" onClick={() => setFilters({ q: '', status: '', from: defaultFrom, to: '' })}>
                {t('admin.clear')}
              </button>
            }
          />
        ) : (
          <EmptyState title={t('bookings.emptyTitle')} body={t('bookings.emptySub')} action={{ label: t('bookings.emptyCta'), href: '/app/calendar/event-types' }} />
        )
      ) : (
        <div className={`cal-bk-groups${loading ? ' is-loading' : ''}`}>
          {groups.map((g) => (
            <section key={g.key} className="cal-bk-day" aria-label={g.label}>
              <h2 className="cal-bk-day-title">
                {g.label}
                {g.key === todayKey && <span className="badge badge-ink">{t('bookings.today')}</span>}
              </h2>
              <ul className="cal-bk-list">
                {g.rows.map((b) => {
                  const started = b.starts_at < now;
                  const open = expanded === b.id;
                  return (
                    <li key={b.id} className={`booking-card-item cal-bk-row${b.status === 'cancelled' ? ' is-cancelled' : ''}`}>
                      <div className="cal-bk-main">
                        <span className="cal-bk-time data">
                          {formatTime(b.starts_at, locale, timezone)}
                          <span className="cal-bk-end">{formatTime(b.ends_at, locale, timezone)}</span>
                        </span>
                        <span className="cal-bk-guest">
                          <strong>{b.invitee_name}</strong>
                          <span className="cal-muted">{b.invitee_email}</span>
                        </span>
                        <span className="cal-bk-event">
                          <span>{b.event_type_title}</span>
                          <span className="cal-muted">
                            {t('editor.minutes', { n: b.event_type_duration_min })}
                            {b.amount_cents > 0 && <span className="data"> · {money(b.amount_cents, b.currency, locale)}</span>}
                            {b.rescheduled_from && ` · ${t('bookings.rescheduled')}`}
                          </span>
                        </span>
                        <span className="cal-bk-state">
                          <span className={`cal-bk-status ${STATUS_BADGE[b.status] ?? 'badge'}`}>
                            {awaitingApproval(b) ? t('booking.status.awaiting') : t(`booking.status.${b.status}`)}
                          </span>
                          {b.approval === 'declined' && b.status === 'cancelled' && (
                            <span className="badge badge-outline">{t('admin.declinedBadge')}</span>
                          )}
                          {b.payment_status === 'paid' && <span className="badge badge-outline">{t('admin.paid')}</span>}
                          {b.payment_status === 'refunded' && <span className="badge badge-outline">{t('admin.refunded')}</span>}
                        </span>
                        <span className="cal-bk-actions">
                          {b.meeting_url && b.status === 'confirmed' && !started && (
                            <a className="btn btn-ghost btn-sm" href={b.meeting_url} target="_blank" rel="noreferrer">
                              {t('bookings.joinShort')}
                            </a>
                          )}
                          {b.status === 'confirmed' && !started && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel({ id: b.id, kind: 'reschedule' })}>
                              {t('admin.reschedule')}
                            </button>
                          )}
                          {b.status === 'confirmed' && started && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-busy={busy === b.id || undefined}
                              onClick={() => void patchBooking(b.id, { status: 'no_show' })}
                            >
                              {t('admin.noShow')}
                            </button>
                          )}
                          {awaitingApproval(b) && !started && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              aria-busy={busy === b.id || undefined}
                              disabled={busy === b.id}
                              onClick={() => void respond(b.id, 'confirm')}
                            >
                              {t('admin.approve')}
                            </button>
                          )}
                          {awaitingApproval(b) ? (
                            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setPanel({ id: b.id, kind: 'decline' })}>
                              {t('admin.decline')}
                            </button>
                          ) : (
                            (b.status === 'confirmed' || b.status === 'pending') && (
                              <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setPanel({ id: b.id, kind: 'cancel' })}>
                                {t('admin.cancel')}
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-expanded={open}
                            aria-controls={`bk-detail-${b.id}`}
                            onClick={() => setExpanded((p) => (p === b.id ? null : b.id))}
                          >
                            {open ? t('common.hide') : t('bookings.details')}
                          </button>
                        </span>
                      </div>

                      {panel?.id === b.id && panel.kind === 'cancel' && (
                        <CancelPanel
                          paid={b.payment_status === 'paid'}
                          busy={busy === b.id}
                          onClose={() => setPanel(null)}
                          onConfirm={async (reason) => {
                            if (await patchBooking(b.id, { status: 'cancelled', cancelReason: reason || null })) setPanel(null);
                          }}
                        />
                      )}
                      {panel?.id === b.id && panel.kind === 'decline' && (
                        <CancelPanel
                          paid={false}
                          decline
                          busy={busy === b.id}
                          onClose={() => setPanel(null)}
                          onConfirm={async (reason) => {
                            if (await respond(b.id, 'decline', reason)) setPanel(null);
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

                      {open && (
                        <dl className="cal-bk-detail" id={`bk-detail-${b.id}`}>
                          {b.timezone && b.timezone !== timezone && (
                            <div>
                              <dt>{t('bookings.guestZone')}</dt>
                              <dd>
                                <span className="data">{formatTime(b.starts_at, locale, b.timezone)}</span> {b.timezone}
                              </dd>
                            </div>
                          )}
                          {b.host_email && (
                            <div>
                              <dt>{t('booking.host')}</dt>
                              <dd>{b.host_name ?? b.host_email}</dd>
                            </div>
                          )}
                          {b.meeting_url && (
                            <div>
                              <dt>{t('bookings.meeting')}</dt>
                              <dd>
                                <a className="data" href={b.meeting_url} target="_blank" rel="noreferrer">
                                  {b.meeting_url}
                                </a>
                              </dd>
                            </div>
                          )}
                          {b.location_kind && b.location !== b.meeting_url && (
                            <div>
                              <dt>{t('booking.where')}</dt>
                              <dd>
                                {t(`location.kind.${isLocationKind(b.location_kind) ? b.location_kind : 'link'}`)}
                                {b.location && (
                                  <>
                                    {': '}
                                    <span className="data">{b.location}</span>
                                  </>
                                )}
                              </dd>
                            </div>
                          )}
                          {guestList(b.guests).length > 0 && (
                            <div>
                              <dt>{t('booking.guests')}</dt>
                              <dd>{guestList(b.guests).join(', ')}</dd>
                            </div>
                          )}
                          {b.cancel_reason && (
                            <div>
                              <dt>{t('manage.cancelReason')}</dt>
                              <dd>{b.cancel_reason}</dd>
                            </div>
                          )}
                          {Object.entries(parseUtm(b.utm)).map(([k, v]) => (
                            <div key={k}>
                              <dt className="data">{k}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                          {b.answers &&
                            b.answers !== '{}' &&
                            answerEntries(b.answers, b.event_type_fields, { yes: t('common.yes'), no: t('common.no') }).map(([k, label, v]) => (
                              <div key={k}>
                                <dt className={label === k ? 'data' : undefined}>{label}</dt>
                                <dd>{v}</dd>
                              </div>
                            ))}
                          <div>
                            <dt>ID</dt>
                            <dd className="data">{b.id}</dd>
                          </div>
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CancelPanel({
  paid,
  decline = false,
  busy,
  onClose,
  onConfirm,
}: {
  paid: boolean;
  /** Rechazar una solicitud en vez de cancelar una reserva confirmada. */
  decline?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations('calendar');
  const [reason, setReason] = useState('');
  return (
    <div className="cal-bk-panel">
      <div className="ui-field">
        <label className="label" htmlFor="cal-cancel-reason">
          {decline ? t('admin.declineReason') : t('admin.cancelReason')}
        </label>
        <textarea id="cal-cancel-reason" className="textarea" rows={2} maxLength={500} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
      </div>
      {paid && <p className="ui-help">{t('admin.refundOnCancel')}</p>}
      <div className="cal-bk-panel-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('admin.keep')}
        </button>
        <button type="button" className="btn btn-primary btn-danger btn-sm" aria-busy={busy || undefined} onClick={() => onConfirm(reason.trim())}>
          {decline ? t('admin.confirmDecline') : t('admin.confirmCancel')}
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
      <p className="ui-help">{t('admin.rescheduleHint')}</p>
      <div className="cal-bk-panel-row">
        <div className="ui-field">
          <label className="label" htmlFor={`cal-rs-${booking.id}`}>
            {t('admin.pickDate')}
          </label>
          <input id={`cal-rs-${booking.id}`} className="input data" type="date" value={date} min={localDay()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <p className="ui-help data">{tz}</p>
      </div>
      {slots === null ? (
        <div className="cal-bk-slots" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="ui-skeleton cal-slot-skeleton" />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <p className="cal-muted">{t('admin.noSlots')}</p>
      ) : (
        <div className="cal-bk-slots">
          {slots.map((s) => (
            <button key={s.start} type="button" className="btn btn-sm data" disabled={busy} onClick={() => void pick(s.start)}>
              {formatTime(s.start, locale)}
            </button>
          ))}
        </div>
      )}
      <div className="cal-bk-panel-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('admin.keep')}
        </button>
      </div>
    </div>
  );
}
