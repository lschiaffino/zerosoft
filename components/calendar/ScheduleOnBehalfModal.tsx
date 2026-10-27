'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import QuickModal from '@/components/app/QuickModal';

export interface OnBehalfEventType {
  id: string;
  title: string;
  durationMin: number;
  /** Anfitriones que se pueden elegir (token opaco + nombre). Vacío = el reparto de siempre. */
  hosts?: Array<{ token: string; name: string }>;
  /** Ubicaciones del evento (clave de la página pública y nombre). */
  locations?: Array<{ key: string; label: string; needsPhone: boolean }>;
}

const COMMON_TZ = [
  'UTC',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'America/Santiago',
  'America/Bogota',
  'America/Mexico_City',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Agendar en nombre de un invitado: tipo de evento, anfitrión (un admin elige
 * a cualquiera del evento; un member agenda consigo), zona horaria del
 * invitado, día y horario libre en esa zona, ubicación, datos del invitado e
 * invitados extra. El invitado recibe la confirmación como si hubiera
 * reservado él (con su link para reprogramar o cancelar).
 */
export default function ScheduleOnBehalfModal({
  open,
  onClose,
  eventTypes,
  onBooked,
  canChooseHost = true,
}: {
  open: boolean;
  onClose: () => void;
  eventTypes: OnBehalfEventType[];
  onBooked: (name: string) => void;
  canChooseHost?: boolean;
}) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const id = useId();
  const localTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : 'UTC';
  const [eventTypeId, setEventTypeId] = useState(eventTypes[0]?.id ?? '');
  const et = eventTypes.find((e) => e.id === eventTypeId);
  const [host, setHost] = useState('');
  const [tz, setTz] = useState(localTz);
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState<Array<{ start: string }> | null>(null);
  const [slot, setSlot] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [guestsText, setGuestsText] = useState('');
  const [locKey, setLocKey] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tzOptions = useMemo(() => (COMMON_TZ.includes(tz) ? COMMON_TZ : [tz, ...COMMON_TZ]), [tz]);

  // Al cambiar de evento: su primer anfitrión elegible (member: él) y su primera ubicación.
  useEffect(() => {
    setHost(canChooseHost ? '' : (et?.hosts?.[0]?.token ?? ''));
    setLocKey(et?.locations?.[0]?.key ?? '');
  }, [eventTypeId, canChooseHost, et]);

  useEffect(() => {
    if (!open || !eventTypeId) return;
    let alive = true;
    setSlots(null);
    setSlot('');
    const hostQs = host ? `&host=${encodeURIComponent(host)}` : '';
    fetch(`/api/calendar/event-types/${eventTypeId}/slots?date=${date}&timezone=${encodeURIComponent(tz)}${hostQs}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d: { slots: Array<{ start: string }> }) => alive && setSlots(d.slots ?? []))
      .catch(() => alive && setSlots([]));
    return () => {
      alive = false;
    };
  }, [open, eventTypeId, date, tz, host]);

  const guests = guestsText
    .split(/[\s,;]+/)
    .map((g) => g.trim())
    .filter(Boolean);
  const guestsOk = guests.every((g) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g)) && guests.length <= 10;
  const chosenLoc = et?.locations?.find((l) => l.key === locKey);
  const valid =
    !!eventTypeId &&
    !!slot &&
    !!name.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    guestsOk &&
    (!chosenLoc?.needsPhone || phone.trim().length >= 6);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/bookings/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventTypeId,
        start: slot,
        timezone: tz,
        name: name.trim(),
        email: email.trim(),
        guests,
        locale,
        ...(host ? { host } : {}),
        ...(locKey ? { location: { key: locKey, ...(chosenLoc?.needsPhone ? { phone: phone.trim() } : {}) } } : {}),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      onBooked(name.trim());
      setName('');
      setEmail('');
      setGuestsText('');
      setSlot('');
      onClose();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz });

  return (
    <QuickModal
      open={open}
      onClose={onClose}
      title={t('onBehalf.title')}
      onSubmit={submit}
      submitLabel={t('onBehalf.submit')}
      cancelLabel={t('common.cancel')}
      submitDisabled={!valid}
      busy={busy}
      error={error}
      width={640}
    >
      {eventTypes.length === 0 ? (
        <p className="cal-muted">{t('onBehalf.noEventTypes')}</p>
      ) : (
        <div className="cal-onbehalf">
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-et`}>
                {t('onBehalf.eventType')}
              </label>
              <select id={`${id}-et`} className="select" value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)} data-autofocus>
                {eventTypes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {t('editor.minutes', { n: e.durationMin })}
                  </option>
                ))}
              </select>
            </div>
            {(et?.hosts?.length ?? 0) > 0 && (
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-host`}>
                  {t('onBehalf.host')}
                </label>
                <select id={`${id}-host`} className="select" value={host} onChange={(e) => setHost(e.target.value)} disabled={!canChooseHost}>
                  {canChooseHost && <option value="">{t('onBehalf.anyHost')}</option>}
                  {et!.hosts!.map((h) => (
                    <option key={h.token} value={h.token}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-tz`}>
                {t('onBehalf.timezone')}
              </label>
              <select id={`${id}-tz`} className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
                {tzOptions.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-date`}>
                {t('admin.pickDate')}
              </label>
              <input id={`${id}-date`} className="input data" type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <fieldset className="cal-onbehalf-slots">
            <legend className="label">{t('onBehalf.time')}</legend>
            {slots === null ? (
              <div className="cal-bk-slots" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="ui-skeleton cal-slot-skeleton" />
                ))}
              </div>
            ) : slots.length === 0 ? (
              <p className="cal-muted">{t('admin.noSlots')}</p>
            ) : (
              <div className="cal-bk-slots" role="radiogroup" aria-label={t('onBehalf.time')}>
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    role="radio"
                    aria-checked={slot === s.start}
                    className={`btn btn-sm data${slot === s.start ? ' btn-primary' : ''}`}
                    onClick={() => setSlot(s.start)}
                  >
                    {timeFmt.format(new Date(s.start))}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
          {(et?.locations?.length ?? 0) > 0 && (
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-loc`}>
                  {t('onBehalf.location')}
                </label>
                <select id={`${id}-loc`} className="select" value={locKey} onChange={(e) => setLocKey(e.target.value)}>
                  {et!.locations!.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              {chosenLoc?.needsPhone && (
                <div className="ui-field">
                  <label className="label" htmlFor={`${id}-phone`}>
                    {t('onBehalf.phone')}
                  </label>
                  <input id={`${id}-phone`} className="input data" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              )}
            </div>
          )}
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-name`}>
                {t('onBehalf.name')}
              </label>
              <input id={`${id}-name`} className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-email`}>
                {t('onBehalf.email')}
              </label>
              <input id={`${id}-email`} className="input" type="email" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-guests`}>
              {t('onBehalf.guests')} <span className="ui-optional">{t('editor.optional')}</span>
            </label>
            <input
              id={`${id}-guests`}
              className="input"
              value={guestsText}
              placeholder="ana@example.com, beto@example.com"
              aria-invalid={!guestsOk || undefined}
              onChange={(e) => setGuestsText(e.target.value)}
              autoComplete="off"
            />
          </div>
          <p className="ui-help">{t('onBehalf.help')}</p>
        </div>
      )}
    </QuickModal>
  );
}
