'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { EventTypeWithRules } from '@/lib/calendar';
import CalIcon from './cal-icons';
import { brandOr, textOn } from './cal-utils';

interface Props {
  eventType: EventTypeWithRules;
  locale: string;
  weekStart?: number;
  /** Nombre del anfitrión (o del workspace) que se muestra arriba del título. */
  hostName?: string;
  /** Pre-fill de los campos del invitado (p.ej. desde ?name=&email=). */
  prefillName?: string;
  prefillEmail?: string;
  /** Modo reprogramar (link de gestión del invitado): elige solo el nuevo horario. */
  reschedule?: { token: string; name: string; email: string };
  /** Máximo de días para reservar ya resuelto en el server (regla del evento o del workspace). */
  maxFutureDays?: number;
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
  'America/Bogota',
  'America/Santiago',
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
    days.push({ date: new Date(prevLast.getFullYear(), prevLast.getMonth(), prevLast.getDate() - i), currentMonth: false });
  }
  for (let d = 1; d <= last.getDate(); d++) days.push({ date: new Date(year, month, d), currentMonth: true });
  // Solo las semanas necesarias: 5 o 6 filas, sin una fila entera del mes siguiente.
  while (days.length % 7 !== 0) {
    const n = days.length - startOffset - last.getDate() + 1;
    days.push({ date: new Date(year, month + 1, n), currentMonth: false });
  }
  return days;
}

function fmt(iso: string, timezone: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: timezone }).format(new Date(iso));
}

/**
 * Página pública de reserva. Lleva la marca del workspace (color de marca,
 * logo, nombre del anfitrión), no la de zerosoft: el color va en los rellenos
 * (día elegido, horario, botón) con el texto en blanco o tinta según contraste.
 */
export default function PublicBookingPage({
  eventType,
  locale,
  weekStart = 1,
  hostName,
  prefillName = '',
  prefillEmail = '',
  reschedule,
  maxFutureDays,
}: Props) {
  const t = useTranslations('calendar');
  const fields = useMemo(() => parseFields(eventType), [eventType]);
  const maxDays = useMemo(() => {
    const rules = (eventType.bookingRulesParsed ?? {}) as Record<string, unknown>;
    return Math.max(1, Number(maxFutureDays ?? rules.maxFutureDays ?? 30));
  }, [eventType, maxFutureDays]);

  const brand = brandOr(eventType.brand_color, brandOr(eventType.color, '#111111'));
  const logoUrl = eventType.logo_url && /^(https?:\/\/|\/)/.test(eventType.logo_url) ? eventType.logo_url : null;
  const brandStyle = { '--bk': brand, '--bk-on': textOn(brand) } as CSSProperties;

  const priceLabel = useMemo(() => {
    if (!eventType.price_cents || eventType.price_cents <= 0 || reschedule) return null;
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: (eventType.currency || 'usd').toUpperCase() }).format(
        eventType.price_cents / 100,
      );
    } catch {
      return `${(eventType.price_cents / 100).toFixed(2)} ${eventType.currency.toUpperCase()}`;
    }
  }, [eventType, locale, reschedule]);

  const [timezone, setTimezone] = useState('UTC');
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<Step>('date');
  const [name, setName] = useState(reschedule?.name ?? prefillName);
  const [email, setEmail] = useState(reschedule?.email ?? prefillEmail);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Embebido: Stripe no se deja enmarcar, así que el pago se abre fuera del iframe. */
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  /** Días del mes visible con lugar (null = cargando: no se deshabilita nada). */
  const [openDays, setOpenDays] = useState<Set<string> | null>(null);
  const slotsHead = useRef<HTMLHeadingElement>(null);
  const formHead = useRef<HTMLHeadingElement>(null);
  const doneHead = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    } catch {
      setTimezone('UTC');
    }
  }, []);

  const rescheduleQs = reschedule ? `&reschedule=${encodeURIComponent(reschedule.token)}` : '';

  useEffect(() => {
    if (!selectedDate) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setSlotsError(false);
    fetch(`/api/calendar/event-types/${eventType.id}/slots?date=${selectedDate}&timezone=${encodeURIComponent(timezone)}${rescheduleQs}`)
      .then((res) => {
        if (!res.ok) throw new Error('slots');
        return res.json();
      })
      .then((data: { slots: Slot[] }) => {
        if (!cancelled) setSlots(data.slots);
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setSlotsError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, timezone, eventType.id, rescheduleQs]);

  // Embebido en un iframe (embed.js): avisar el alto y la reserva confirmada.
  const embedded = typeof window !== 'undefined' && window.parent !== window;
  useEffect(() => {
    if (!embedded) return;
    document.documentElement.classList.add('zs-embed');
    // Alto del contenido, no del documento: scrollHeight nunca baja del alto del iframe
    // y una página más corta que el iframe quedaría con espacio vacío abajo.
    const post = () => {
      const bottom = Math.max(0, ...Array.from(document.body.children).map((el) => el.getBoundingClientRect().bottom));
      window.parent.postMessage({ type: 'zs-cal:height', height: Math.ceil(bottom + window.scrollY) }, '*');
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [embedded]);
  useEffect(() => {
    if (embedded && step === 'confirm' && selectedSlot) {
      window.parent.postMessage({ type: 'zs-cal:booked', start: selectedSlot.start, eventTypeId: eventType.id }, '*');
    }
  }, [embedded, step, selectedSlot, eventType.id]);

  const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
  useEffect(() => {
    let cancelled = false;
    setOpenDays(null);
    fetch(`/api/calendar/event-types/${eventType.id}/slots?month=${monthKey}&timezone=${encodeURIComponent(timezone)}${rescheduleQs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { days?: string[] } | null) => {
        if (!cancelled && data?.days) setOpenDays(new Set(data.days));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [monthKey, timezone, eventType.id, rescheduleQs]);

  // Foco al cambiar de paso: el lector de pantalla anuncia dónde está.
  useEffect(() => {
    if (step === 'form') formHead.current?.focus();
    if (step === 'confirm') doneHead.current?.focus();
  }, [step]);

  const minDate = isoDate(new Date());
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + maxDays);
    return isoDate(d);
  }, [maxDays]);
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const canPrev = currentMonth > thisMonth;
  const canNext = isoDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)) <= maxDate;

  const calendarDays = useMemo(
    () => getCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth(), weekStart),
    [currentMonth, weekStart],
  );
  const weekDayLabels = useMemo(() => {
    const base = new Date(2024, 0, 7); // domingo
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i + weekStart);
      return {
        short: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d).replace('.', ''),
        long: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d),
      };
    });
  }, [locale, weekStart]);

  function isDateDisabled(date: Date) {
    const iso = isoDate(date);
    if (iso < minDate || iso > maxDate) return true;
    return openDays !== null && !openDays.has(iso);
  }
  const monthHasDays = openDays === null || calendarDays.some(({ date, currentMonth: cur }) => cur && !isDateDisabled(date));

  function selectDate(iso: string) {
    setSelectedDate(iso);
    setSelectedSlot(null);
    setStep('date');
    setError(null);
    requestAnimationFrame(() => slotsHead.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  function selectSlot(slot: Slot) {
    setSelectedSlot(slot);
    setStep('form');
    setError(null);
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
          body: JSON.stringify({ eventTypeId: eventType.id, start: selectedSlot.start, email, name, timezone, answers, locale }),
        }).catch(() => null);
    setBusy(false);

    if (res && (res.status === 201 || (reschedule && res.status === 200))) {
      const data = (await res.json().catch(() => null)) as { manageToken?: string; checkoutUrl?: string } | null;
      // Evento pago: la reserva queda retenida y se confirma al pagar en Stripe.
      if (data?.checkoutUrl && /^https:\/\//.test(data.checkoutUrl)) {
        if (window.parent !== window) {
          // En un iframe (embed.js) la página contenedora navega a Checkout; si
          // no hay embed.js que escuche, queda el link para abrirlo aparte.
          window.parent.postMessage({ type: 'zs-cal:checkout', url: data.checkoutUrl }, '*');
          setCheckoutUrl(data.checkoutUrl);
          return;
        }
        setBusy(true);
        window.location.assign(data.checkoutUrl);
        return;
      }
      const token = reschedule?.token ?? data?.manageToken;
      if (token) setManageUrl(`/${locale}/book/manage/${token}`);
      setStep('confirm');
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
    if (code === 'slot_unavailable') {
      // El horario se ocupó mientras tanto: se vuelve a la lista con los horarios frescos.
      setSlots((prev) => prev.filter((s) => s.start !== selectedSlot.start));
    }
  }

  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(currentMonth);
  const dayLabel = (d: Date) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const selectedDateLabel = selectedDate
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${selectedDate}T12:00:00`))
    : '';
  const when = selectedSlot
    ? {
        date: fmt(selectedSlot.start, timezone, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        time: `${fmt(selectedSlot.start, timezone, locale, { hour: '2-digit', minute: '2-digit' })} – ${fmt(selectedSlot.end, timezone, locale, { hour: '2-digit', minute: '2-digit' })}`,
      }
    : null;
  const tzOptions = COMMON_TIMEZONES.includes(timezone) ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES];

  return (
    <div className="bk" style={brandStyle}>
      <div className={`bk-card${step === 'date' && selectedDate ? ' bk-has-slots' : ''}`}>
        <BookingInfo
          logoUrl={logoUrl}
          hostName={hostName}
          title={eventType.title}
          meta={[
            { icon: 'clock', text: t('booking.minutes', { n: eventType.duration_min }) },
            ...(eventType.location ? [{ icon: 'pin' as const, text: eventType.location }] : []),
            ...(priceLabel ? [{ icon: 'card' as const, text: priceLabel, data: true }] : []),
          ]}
          welcome={eventType.welcome_message}
          description={eventType.description}
        >
          {when && step !== 'date' && (
            <div className="bk-when">
              <p className="bk-when-date">{when.date}</p>
              <p className="bk-when-time data">{when.time}</p>
              <p className="bk-when-tz">{timezone}</p>
              {step === 'form' && (
                <button type="button" className="bk-link" onClick={() => setStep('date')}>
                  {t('booking.changeTime')}
                </button>
              )}
            </div>
          )}
        </BookingInfo>

        <div className="bk-main">
          {step === 'confirm' && when ? (
            <section className="bk-done" aria-labelledby="bk-done-title">
              <span className="bk-done-mark" aria-hidden="true">
                <CalIcon name="check" size={22} />
              </span>
              <h2 id="bk-done-title" className="bk-h2" tabIndex={-1} ref={doneHead}>
                {reschedule ? t('booking.rescheduledTitle') : t('booking.confirmedTitle')}
              </h2>
              <dl className="bk-summary">
                <div>
                  <dt>{t('booking.when')}</dt>
                  <dd>
                    {when.date}
                    <br />
                    <span className="data">{when.time}</span> <span className="bk-muted">{timezone}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t('booking.who')}</dt>
                  <dd>
                    {name}
                    <br />
                    <span className="bk-muted">{email}</span>
                  </dd>
                </div>
                {eventType.location && (
                  <div>
                    <dt>{t('booking.where')}</dt>
                    <dd>{eventType.location}</dd>
                  </div>
                )}
              </dl>
              <p className="bk-muted">{t('booking.emailSent')}</p>
              {manageUrl && (
                <a className="bk-link" href={manageUrl}>
                  {t('booking.manageLink')}
                </a>
              )}
            </section>
          ) : step === 'form' && selectedSlot ? (
            <form className="bk-form" onSubmit={submit}>
              <h2 className="bk-h2" tabIndex={-1} ref={formHead}>
                {reschedule ? t('booking.confirmNewTimeTitle') : t('booking.yourDetails')}
              </h2>
              {!reschedule && (
                <>
                  <div className="ui-field">
                    <label className="label" htmlFor="bk-name">
                      {t('booking.name')}
                    </label>
                    <input id="bk-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="ui-field">
                    <label className="label" htmlFor="bk-email">
                      {t('booking.email')}
                    </label>
                    <input
                      id="bk-email"
                      className="input"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  {fields.map((field) =>
                    field.type === 'boolean' ? (
                      <label key={field.name} className="ui-check">
                        <input
                          type="checkbox"
                          checked={!!answers[field.name]}
                          onChange={(e) => setAnswers((p) => ({ ...p, [field.name]: e.target.checked }))}
                          required={field.required}
                        />
                        <span>{field.label}</span>
                      </label>
                    ) : (
                      <div key={field.name} className="ui-field">
                        <label className="label" htmlFor={`bk-f-${field.name}`}>
                          {field.label} {!field.required && <span className="ui-optional">{t('editor.optional')}</span>}
                        </label>
                        <input
                          id={`bk-f-${field.name}`}
                          className="input"
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={String(answers[field.name] ?? '')}
                          onChange={(e) => setAnswers((p) => ({ ...p, [field.name]: e.target.value }))}
                          required={field.required}
                        />
                      </div>
                    ),
                  )}
                </>
              )}
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
              {checkoutUrl && (
                <a className="bk-link" href={checkoutUrl} target="_blank" rel="noopener noreferrer">
                  {t('booking.openCheckout')}
                </a>
              )}
              <div className="bk-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setStep('date')}>
                  {t('booking.back')}
                </button>
                <button type="submit" className="btn bk-cta" aria-busy={busy || undefined} disabled={!!checkoutUrl}>
                  {busy && priceLabel
                    ? t('booking.redirecting')
                    : reschedule
                      ? t('booking.confirmNewTime')
                      : priceLabel
                        ? `${t('booking.payAndConfirm')} · ${priceLabel}`
                        : t('booking.confirm')}
                </button>
              </div>
            </form>
          ) : (
            <div className="bk-pick">
              <section className="bk-cal" aria-labelledby="bk-month">
                <h2 className="bk-h2">{reschedule ? t('booking.pickNewDay') : t('booking.pickDay')}</h2>
                <div className="bk-cal-head">
                  <p id="bk-month" className="bk-month" aria-live="polite">
                    {monthLabel}
                  </p>
                  <div className="bk-cal-nav">
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                      disabled={!canPrev}
                      aria-label={t('booking.prevMonth')}
                      title={t('booking.prevMonth')}
                    >
                      <CalIcon name="prev" size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                      disabled={!canNext}
                      aria-label={t('booking.nextMonth')}
                      title={t('booking.nextMonth')}
                    >
                      <CalIcon name="next" size={16} />
                    </button>
                  </div>
                </div>
                <div className="bk-grid" role="group" aria-labelledby="bk-month" aria-busy={openDays === null || undefined}>
                  {weekDayLabels.map((w, i) => (
                    <abbr key={i} className="bk-wd" title={w.long}>
                      {w.short}
                    </abbr>
                  ))}
                  {calendarDays.map(({ date, currentMonth: current }, i) => {
                    const iso = isoDate(date);
                    if (!current) return <span key={i} className="bk-day-pad" aria-hidden="true" />;
                    const disabled = isDateDisabled(date);
                    const selected = selectedDate === iso;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`bk-day${selected ? ' is-selected' : ''}${!disabled ? ' is-open' : ''}${iso === minDate ? ' is-today' : ''}`}
                        disabled={disabled}
                        onClick={() => selectDate(iso)}
                        aria-label={dayLabel(date)}
                        aria-pressed={selected}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>
                {!monthHasDays && (
                  <p className="bk-note">
                    {t('booking.noDaysThisMonth')}{' '}
                    {canNext && (
                      <button
                        type="button"
                        className="bk-link"
                        onClick={() => setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                      >
                        {t('booking.tryNextMonth')}
                      </button>
                    )}
                  </p>
                )}
                <label className="bk-tz">
                  <span className="bk-tz-label">
                    <CalIcon name="globe" />
                    {t('booking.timezone')}
                  </span>
                  <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {tzOptions.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              {selectedDate && (
                <section className="bk-slots" aria-labelledby="bk-slots-title">
                  <h2 id="bk-slots-title" className="bk-h2 bk-slots-title" ref={slotsHead}>
                    {selectedDateLabel}
                  </h2>
                  {loadingSlots ? (
                    <div className="bk-slot-list" aria-busy="true" aria-label={t('booking.loadingSlots')}>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className="ui-skeleton bk-slot-skeleton" />
                      ))}
                    </div>
                  ) : slotsError ? (
                    <p className="bk-note" role="alert">
                      {t('booking.slotsError')}
                    </p>
                  ) : slots.length === 0 ? (
                    <p className="bk-note">{t('booking.noSlots')}</p>
                  ) : (
                    <div className="bk-slot-list">
                      {slots.map((slot) => (
                        <button
                          key={slot.start}
                          type="button"
                          className={`booking-slot bk-slot${selectedSlot?.start === slot.start ? ' is-selected' : ''}`}
                          onClick={() => selectSlot(slot)}
                          aria-pressed={selectedSlot?.start === slot.start}
                        >
                          {fmt(slot.start, timezone, locale, { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  )}
                  {error && (
                    <p className="ui-error" role="alert">
                      {error}
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Columna de la izquierda: quién, qué, cuánto dura y dónde. La comparten reserva, gestión y routing. */
export function BookingInfo({
  logoUrl,
  hostName,
  title,
  meta = [],
  welcome,
  description,
  children,
}: {
  logoUrl?: string | null;
  hostName?: string;
  title: string;
  meta?: Array<{ icon: 'clock' | 'pin' | 'card' | 'globe'; text: string; data?: boolean }>;
  welcome?: string | null;
  description?: string | null;
  children?: ReactNode;
}) {
  return (
    <aside className="bk-info">
      {(logoUrl || hostName) && (
        <div className="bk-host">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={hostName ?? ''} className="bk-logo" />
          ) : (
            <span className="bk-monogram" aria-hidden="true">
              {hostName?.trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          {hostName && <p className="bk-host-name">{hostName}</p>}
        </div>
      )}
      <h1 className="bk-title">{title}</h1>
      {meta.length > 0 && (
        <ul className="bk-meta">
          {meta.map((m) => (
            <li key={m.text}>
              <CalIcon name={m.icon} size={16} />
              <span className={m.data ? 'data' : undefined}>{m.text}</span>
            </li>
          ))}
        </ul>
      )}
      {welcome && <p className="bk-welcome">{welcome}</p>}
      {description && <p className="bk-desc">{description}</p>}
      {children}
    </aside>
  );
}
