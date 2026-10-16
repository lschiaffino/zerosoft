'use client';

import { useTranslations } from 'next-intl';
import CalIcon from './cal-icons';

export interface HourRule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/** Lunes primero, como se lee una semana de trabajo. */
const DAYS = [1, 2, 3, 4, 5, 6, 0];

/**
 * Horas semanales editables (controlado): un renglón por día con su casilla,
 * los rangos de ese día y un botón para sumar otro. Lo usan los horarios
 * reutilizables y las horas propias de un tipo de evento.
 */
export default function WeeklyHours({ rules, onChange }: { rules: HourRule[]; onChange: (next: HourRule[]) => void }) {
  const t = useTranslations('calendar');
  const dayName = (d: number) => t(`availability.day.${d}`);

  function setDay(day: number, on: boolean) {
    const others = rules.filter((r) => r.dayOfWeek !== day);
    onChange(on ? [...others, { dayOfWeek: day, startTime: '09:00', endTime: '17:00' }] : others);
  }
  function update(index: number, p: Partial<HourRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...p } : r)));
  }
  function remove(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }
  function addRange(day: number) {
    const last = rules
      .filter((r) => r.dayOfWeek === day)
      .sort((a, b) => a.endTime.localeCompare(b.endTime))
      .pop();
    const start = last && last.endTime < '22:00' ? last.endTime : '09:00';
    const [h, m] = start.split(':').map(Number);
    const end = `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    onChange([...rules, { dayOfWeek: day, startTime: start, endTime: end }]);
  }

  return (
    <div className="cal-week" role="group" aria-label={t('schedules.weekly')}>
      {DAYS.map((day) => {
        const ranges = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.dayOfWeek === day);
        const on = ranges.length > 0;
        return (
          <div key={day} className="cal-week-row" data-on={on || undefined}>
            <label className="ui-check cal-week-day">
              <input type="checkbox" checked={on} onChange={(e) => setDay(day, e.target.checked)} />
              <span>{dayName(day)}</span>
            </label>
            <div className="cal-week-ranges">
              {!on ? (
                <span className="cal-week-off">{t('schedules.unavailable')}</span>
              ) : (
                ranges.map(({ r, i }) => {
                  const bad = r.endTime <= r.startTime;
                  return (
                    <div key={i} className="cal-range">
                      <input
                        className="input data"
                        type="time"
                        value={r.startTime}
                        aria-label={t('schedules.rangeStart', { day: dayName(day) })}
                        aria-invalid={bad || undefined}
                        onChange={(e) => update(i, { startTime: e.target.value })}
                      />
                      <span className="cal-range-sep" aria-hidden="true" />
                      <input
                        className="input data"
                        type="time"
                        value={r.endTime}
                        aria-label={t('schedules.rangeEnd', { day: dayName(day) })}
                        aria-invalid={bad || undefined}
                        onChange={(e) => update(i, { endTime: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => remove(i)}
                        aria-label={t('schedules.removeRange', { day: dayName(day) })}
                        title={t('common.remove')}
                      >
                        <CalIcon name="close" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            {on && (
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm cal-week-add"
                onClick={() => addRange(day)}
                aria-label={t('schedules.addRangeFor', { day: dayName(day) })}
                title={t('schedules.addRange')}
              >
                <CalIcon name="plus" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
