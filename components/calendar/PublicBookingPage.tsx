'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { EventTypeWithRules } from '@/lib/calendar';

interface Props {
  eventType: EventTypeWithRules;
  locale: string;
  weekStart?: number;
  /** Pre-fill de los campos del invitado (p.ej. desde ?name=&email=). */
  prefillName?: string;
  prefillEmail?: string;
  /** Modo reprogramar (link de gestión del invitado): elige solo el nuevo horario. */
  reschedule?: { token: string; name: string; email: string };
}

interface Slot {
  start: string;
  end: string;
}

interface CustomField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  required?: boolean;
}

type Step = 'date' | 'form' | 'confirm';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function parseFields(eventType: EventTypeWithRules): CustomField[] {
  const list = eventType.fieldsParsed;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      name: typeof f.name === 'string' ? f.name : '',
      label: typeof f.label === 'string' ? f.label : '',
      type: ['text', 'number', 'boolean'].includes(typeof f.type === 'string' ? f.type : '')
        ? (f.type as 'text' | 'number' | 'boolean')
        : 'text',
      required: f.required === true,
    }))
    .filter((f) => f.name && f.label);
}

function getRules(eventType: EventTypeWithRules) {
  const rules = (eventType.bookingRulesParsed ?? {}) as Record<string, unknown>;
  return {
    maxFutureDays: Math.max(1, Number(rules.maxFutureDays ?? 30)),
    minNoticeHours: Math.max(0, Number(rules.minNoticeHours ?? 0)),
  };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCalendarDays(year: number, month: number, weekStart: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = (first.getDay() - weekStart + 7) % 7;
  const days: Array<{ date: Date; currentMonth: boolean }> = [];
  const prevLast = new Date(year, month, 0);
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push({
      date: new Date(prevLast.getFullYear(), prevLast.getMonth(), prevLast.getDate() - i),
      currentMonth: false,
    });
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push({ date: new Date(year, month, d), currentMonth: true });
  }
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({ date: new Date(year, month + 1, d), currentMonth: false });
  }
  return days;
}

function formatSlotTime(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

function formatSlotRange(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

export default function PublicBookingPage({ eventType, locale, weekStart = 1, prefillName = '', prefillEmail = '', reschedule }: Props) {
  const t = useTranslations('calendar');
  const fields = useMemo(() => parseFields(eventType), [eventType]);
  const rules = useMemo(() => getRules(eventType), [eventType]);

  // Branding: brand_color validado (hex), cae al color del evento.
  const brandColor = useMemo(() => {
    const c = eventType.brand_color;
    return c && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : eventType.color;
  }, [eventType]);
  const logoUrl = useMemo(() => {
    const url = eventType.logo_url;
    return url && /^(https?:\/\/|\/)/.test(url) ? url : null;
  }, [eventType]);

  const [timezone, setTimezone] = useState('UTC');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<Step>('date');
  const [name, setName] = useState(reschedule?.name ?? prefillName);
  const [email, setEmail] = useState(reschedule?.email ?? prefillEmail);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  /** Días del mes visible con lugar (null = cargando: no se deshabilita nada). */
  const [openDays, setOpenDays] = useState<Set<string> | null>(null);

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(tz || 'UTC');
    } catch {
      setTimezone('UTC');
    }
  }, []);

  useEffect(() => {
    if (!selectedDate) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    fetch(
      `/api/calendar/event-types/${eventType.id}/slots?date=${selectedDate}&timezone=${encodeURIComponent(timezone)}${
        reschedule ? `&reschedule=${encodeURIComponent(reschedule.token)}` : ''
      }`,
    )
      .then((res) => (res.ok ? res.json() : { slots: [] }))
      .then((data: { slots: Slot[] }) => {
        if (!cancelled) setSlots(data.slots);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, timezone, eventType.id, reschedule]);

  const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
  useEffect(() => {
    let cancelled = false;
    setOpenDays(null);
    fetch(
      `/api/calendar/event-types/${eventType.id}/slots?month=${monthKey}&timezone=${encodeURIComponent(timezone)}${
        reschedule ? `&reschedule=${encodeURIComponent(reschedule.token)}` : ''
      }`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { days?: string[] } | null) => {
        if (!cancelled && data?.days) setOpenDays(new Set(data.days));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [monthKey, timezone, eventType.id, reschedule]);

  const today = new Date();
  const minDate = isoDate(today);
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + rules.maxFutureDays);
    return isoDate(d);
  }, [rules.maxFutureDays]);

  const calendarDays = useMemo(
    () => getCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth(), weekStart),
    [currentMonth, weekStart],
  );

  const weekDayLabels = useMemo(() => {
    const labels: string[] = [];
    const base = new Date(2024, 0, 7); // Sunday
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i + weekStart);
      labels.push(
        new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(d),
      );
    }
    return labels;
  }, [locale, weekStart]);

  function isDateDisabled(date: Date) {
    const iso = isoDate(date);
    if (iso < minDate || iso > maxDate) return true;
    return openDays !== null && !openDays.has(iso);
  }

  function selectDate(iso: string) {
    setSelectedDate(iso);
    setSelectedSlot(null);
    setStep('date');
    setError(null);
  }

  function selectSlot(slot: Slot) {
    setSelectedSlot(slot);
    setStep('form');
    setError(null);
  }

  function updateAnswer(key: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setBusy(true);
    setError(null);

    const res = reschedule
      ? await fetch(`/api/calendar/bookings/manage/${encodeURIComponent(reschedule.token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'reschedule', start: selectedSlot.start, timezone, locale }),
        }).catch(() => null)
      : await fetch('/api/calendar/bookings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            eventTypeId: eventType.id,
            start: selectedSlot.start,
            email,
            name,
            timezone,
            answers,
            locale,
          }),
        }).catch(() => null);

    setBusy(false);

    if (res && (res.status === 201 || (reschedule && res.status === 200))) {
      const data = (await res.json().catch(() => null)) as { manageToken?: string } | null;
      const token = reschedule?.token ?? data?.manageToken;
      if (token) setManageUrl(`/${locale}/book/manage/${token}`);
      setConfirmed(true);
      setStep('confirm');
      return;
    }

    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  function monthLabel(d: Date) {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(d);
  }

  return (
    <div className="booking-page">
      <div className="booking-card">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="booking-logo" />
        )}
        <header className="booking-header">
          <span
            className="calendar-event-dot-large"
            style={{ backgroundColor: brandColor }}
            aria-hidden
          />
          <div>
            <h1 className="booking-title">{eventType.title}</h1>
            <p className="booking-meta">
              <span>
                {eventType.duration_min} {t('eventTypes.minutes')}
              </span>
              {eventType.location && <span className="muted"> · {eventType.location}</span>}
            </p>
          </div>
        </header>

        {eventType.welcome_message && (
          <p className="booking-welcome">{eventType.welcome_message}</p>
        )}

        {eventType.description && (
          <p className="booking-description">{eventType.description}</p>
        )}

        <label className="booking-timezone">
          <span className="prop-label">{t('booking.timezone')}</span>
          <select
            className="select"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {(COMMON_TIMEZONES.includes(timezone) ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES]).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>

        {step === 'confirm' && confirmed && selectedSlot ? (
          <section className="booking-confirm">
            <h2 className="section-label">
              {reschedule ? t('booking.rescheduledTitle') : t('booking.confirmedTitle')}
            </h2>
            <p className="booking-confirm-time">
              {formatSlotRange(selectedSlot.start, timezone, locale)}
            </p>
            <p className="booking-confirm-tz muted">
              {timezone}
            </p>
            <p className="booking-confirm-detail">
              {name} · {email}
            </p>
            {eventType.location && (
              <p className="booking-confirm-detail muted">{eventType.location}</p>
            )}
            <p className="booking-confirm-detail muted">{t('booking.emailSent')}</p>
            {manageUrl && (
              <p className="booking-confirm-detail">
                <a href={manageUrl}>{t('booking.manageLink')}</a>
              </p>
            )}
          </section>
        ) : (
          <>
            <div className={`booking-body${selectedDate ? ' has-slots' : ''}`}>
            <section className="booking-calendar-section">
              <div className="booking-calendar-head">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                >
                  ‹
                </button>
                <span className="booking-month">{monthLabel(currentMonth)}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                >
                  ›
                </button>
              </div>

              <div className="booking-calendar-grid">
                {weekDayLabels.map((label, i) => (
                  <span key={i} className="booking-calendar-weekday">
                    {label}
                  </span>
                ))}
                {calendarDays.map(({ date, currentMonth: current }, i) => {
                  const iso = isoDate(date);
                  const disabled = !current || isDateDisabled(date);
                  const selected = selectedDate === iso;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`booking-calendar-day${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}${!current ? ' off' : ''}`}
                      disabled={disabled}
                      onClick={() => selectDate(iso)}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedDate && (
              <section className="booking-slots">
                <p className="section-label">{t('booking.slotsFor')} {selectedDate}</p>
                {loadingSlots ? (
                  <p className="muted">{t('booking.loadingSlots')}</p>
                ) : slots.length === 0 ? (
                  <p className="muted">{t('booking.noSlots')}</p>
                ) : (
                  <div className="booking-slot-list">
                    {slots.map((slot, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`booking-slot${selectedSlot?.start === slot.start ? ' selected' : ''}`}
                        onClick={() => selectSlot(slot)}
                      >
                        {formatSlotTime(slot.start, timezone, locale)}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
            </div>

            {step === 'form' && selectedSlot && (
              <form className="booking-form" onSubmit={submit}>
                {reschedule ? (
                  <p className="booking-confirm-time">{formatSlotRange(selectedSlot.start, timezone, locale)}</p>
                ) : (
                <>
                <p className="section-label">{t('booking.yourDetails')}</p>
                <label className="field">
                  <span className="prop-label">{t('booking.name')}</span>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span className="prop-label">{t('booking.email')}</span>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>

                {fields.map((field) => (
                  <label key={field.name} className="field">
                    <span className="prop-label">
                      {field.label}
                      {field.required && <span className="muted"> *</span>}
                    </span>
                    {field.type === 'boolean' ? (
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={!!answers[field.name]}
                          onChange={(e) => updateAnswer(field.name, e.target.checked)}
                          required={field.required}
                        />
                        <span>{field.label}</span>
                      </label>
                    ) : field.type === 'number' ? (
                      <input
                        className="input"
                        type="number"
                        value={String(answers[field.name] ?? '')}
                        onChange={(e) => updateAnswer(field.name, e.target.value)}
                        required={field.required}
                      />
                    ) : (
                      <input
                        className="input"
                        value={String(answers[field.name] ?? '')}
                        onChange={(e) => updateAnswer(field.name, e.target.value)}
                        required={field.required}
                      />
                    )}
                  </label>
                ))}
                </>
                )}

                {error && <p className="form-error">{error}</p>}

                <div className="booking-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => setStep('date')}
                  >
                    {t('common.back')}
                  </button>
                  <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
                    {busy ? t('common.saving') : reschedule ? t('booking.confirmNewTime') : t('booking.confirm')}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
