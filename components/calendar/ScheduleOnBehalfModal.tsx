'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import QuickModal from '@/components/app/QuickModal';

export interface OnBehalfEventType {
  id: string;
  title: string;
  durationMin: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Agendar en nombre de un invitado: tipo de evento, día, un horario libre y
 * los datos del invitado. El invitado recibe la confirmación como si hubiera
 * reservado él (con su link para reprogramar o cancelar).
 */
export default function ScheduleOnBehalfModal({
  open,
  onClose,
  eventTypes,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  eventTypes: OnBehalfEventType[];
  onBooked: (name: string) => void;
}) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const id = useId();
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : 'UTC';
  const [eventTypeId, setEventTypeId] = useState(eventTypes[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState<Array<{ start: string }> | null>(null);
  const [slot, setSlot] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !eventTypeId) return;
    let alive = true;
    setSlots(null);
    setSlot('');
    fetch(`/api/calendar/event-types/${eventTypeId}/slots?date=${date}&timezone=${encodeURIComponent(tz)}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d: { slots: Array<{ start: string }> }) => alive && setSlots(d.slots ?? []))
      .catch(() => alive && setSlots([]));
    return () => {
      alive = false;
    };
  }, [open, eventTypeId, date, tz]);

  const valid = !!eventTypeId && !!slot && !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/bookings/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventTypeId, start: slot, timezone: tz, name: name.trim(), email: email.trim(), locale }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      onBooked(name.trim());
      setName('');
      setEmail('');
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
    >
      {eventTypes.length === 0 ? (
        <p className="cal-muted">{t('onBehalf.noEventTypes')}</p>
      ) : (
        <div className="cal-onbehalf">
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
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-date`}>
              {t('admin.pickDate')} <span className="ui-optional data">{tz}</span>
            </label>
            <input id={`${id}-date`} className="input data" type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
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
          <p className="ui-help">{t('onBehalf.help')}</p>
        </div>
      )}
    </QuickModal>
  );
}
