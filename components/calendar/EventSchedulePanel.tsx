'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { CalendarAvailabilityRow } from '@/lib/db';
import { scheduleDisplayName } from '@/lib/calendar-schedule-name';
import AvailabilityEditor from './AvailabilityEditor';

interface ScheduleOption {
  id: string;
  name: string;
  timezone: string;
  summary: string[];
}

interface Props {
  eventTypeId: string;
  schedules: ScheduleOption[];
  scheduleId: string | null;
  customRules: CalendarAvailabilityRow[];
}

const CUSTOM = '__custom__';

/** Horario del tipo de evento: uno reutilizable o, como antes, horas propias. */
export default function EventSchedulePanel({ eventTypeId, schedules, scheduleId, customRules }: Props) {
  const t = useTranslations('calendar');
  const [value, setValue] = useState(scheduleId ?? CUSTOM);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function choose(next: string) {
    setValue(next);
    setSaved(false);
    // Pasar a horas propias se guarda al guardar esas horas.
    if (next === CUSTOM) return;
    setBusy(true);
    const res = await fetch(`/api/calendar/event-types/${eventTypeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduleId: next }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) setSaved(true);
  }

  const selected = schedules.find((s) => s.id === value);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('availability.title')}</p>
          <Link href="/app/calendar/availability" className="mono cal-panel-link">
            {t('schedules.manage')} →
          </Link>
        </div>
        <label className="field">
          <span className="prop-label">{t('schedules.pick')}</span>
          <select className="select" value={value} disabled={busy} onChange={(e) => choose(e.target.value)}>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {scheduleDisplayName(s.name, t('schedules.defaultName'))} · {s.timezone}
              </option>
            ))}
            <option value={CUSTOM}>{t('schedules.custom')}</option>
          </select>
        </label>
        {selected ? (
          <ul className="cal-sched-summary mono">
            {selected.summary.length === 0 ? <li className="muted">{t('schedules.unavailable')}</li> : null}
            {selected.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="muted cal-sched-hint">{t('schedules.customHint')}</p>
        )}
        {saved && <p className="muted mono">{t('common.saved')}</p>}
      </section>
      {value === CUSTOM && <AvailabilityEditor eventTypeId={eventTypeId} initialRules={customRules} />}
    </>
  );
}
