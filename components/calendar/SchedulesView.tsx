'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ScheduleDetail, ScheduleOverride, ScheduleRule } from '@/lib/calendar-schedules';
import { scheduleDisplayName } from '@/lib/calendar-schedule-name';

interface Props {
  initial: ScheduleDetail[];
  defaultTimezone: string;
}

interface Draft {
  id: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  rules: ScheduleRule[];
  overrides: ScheduleOverride[];
  eventTypeCount: number;
}

/** Orden de días que ve la gente: lunes primero. */
const DAYS = [1, 2, 3, 4, 5, 6, 0];

/** `defaultName`: nombre traducido del horario por defecto (se guarda así al editarlo). */
function toDraft(s: ScheduleDetail, defaultName: string): Draft {
  return {
    id: s.id,
    name: scheduleDisplayName(s.name, defaultName),
    timezone: s.timezone,
    isDefault: s.is_default === 1,
    rules: s.rules,
    overrides: s.overrides,
    eventTypeCount: s.eventTypeCount,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SchedulesView({ initial, defaultTimezone }: Props) {
  const t = useTranslations('calendar');
  const [schedules, setSchedules] = useState<Draft[]>(initial.map((s) => toDraft(s, t('schedules.defaultName'))));
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timezones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);

  const draft = schedules.find((s) => s.id === selectedId) ?? null;

  function patch(p: Partial<Draft>) {
    if (!draft) return;
    setSchedules((prev) => prev.map((s) => (s.id === draft.id ? { ...s, ...p } : s)));
    setSaved(false);
  }

  function errorText(code: string | undefined): string {
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  }

  async function readError(res: Response | null): Promise<string> {
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    return errorText(typeof data?.error === 'string' ? data.error : data?.error?.code);
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: t('schedules.newName'), timezone: defaultTimezone }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      const created = toDraft((await res.json()) as ScheduleDetail, t('schedules.defaultName'));
      setSchedules((prev) => [...prev, created]);
      setSelectedId(created.id);
      return;
    }
    setError(await readError(res));
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/schedules/${draft.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: draft.name,
        timezone: draft.timezone,
        isDefault: draft.isDefault || undefined,
        rules: draft.rules,
        overrides: draft.overrides,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      const updated = toDraft((await res.json()) as ScheduleDetail, t('schedules.defaultName'));
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === updated.id ? updated : updated.isDefault ? { ...s, isDefault: false } : s,
        ),
      );
      setSaved(true);
      return;
    }
    setError(await readError(res));
  }

  async function remove() {
    if (!draft || !confirm(t('schedules.deleteConfirm', { name: draft.name }))) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/schedules/${draft.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res && res.status === 204) {
      const rest = schedules.filter((s) => s.id !== draft.id);
      setSchedules(rest);
      setSelectedId(rest[0]?.id ?? null);
      return;
    }
    setError(await readError(res));
  }

  // ---- horas semanales ----
  function setDayEnabled(day: number, on: boolean) {
    if (!draft) return;
    const others = draft.rules.filter((r) => r.dayOfWeek !== day);
    patch({ rules: on ? [...others, { dayOfWeek: day, startTime: '09:00', endTime: '17:00' }] : others });
  }
  function updateRule(index: number, p: Partial<ScheduleRule>) {
    if (!draft) return;
    patch({ rules: draft.rules.map((r, i) => (i === index ? { ...r, ...p } : r)) });
  }
  function removeRule(index: number) {
    if (!draft) return;
    patch({ rules: draft.rules.filter((_, i) => i !== index) });
  }
  function addRange(day: number) {
    if (!draft) return;
    const last = draft.rules.filter((r) => r.dayOfWeek === day).sort((a, b) => a.endTime.localeCompare(b.endTime)).pop();
    const start = last && last.endTime < '22:00' ? last.endTime : '09:00';
    const [h, m] = start.split(':').map(Number);
    const end = `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    patch({ rules: [...draft.rules, { dayOfWeek: day, startTime: start, endTime: end }] });
  }

  // ---- excepciones ----
  function addOverride() {
    if (!draft) return;
    patch({ overrides: [...draft.overrides, { date: today(), startTime: null, endTime: null }] });
  }
  function updateOverride(index: number, p: Partial<ScheduleOverride>) {
    if (!draft) return;
    patch({ overrides: draft.overrides.map((o, i) => (i === index ? { ...o, ...p } : o)) });
  }
  function removeOverride(index: number) {
    if (!draft) return;
    patch({ overrides: draft.overrides.filter((_, i) => i !== index) });
  }

  return (
    <div className="cal-sched">
      <aside className="cal-sched-list">
        <ul>
          {schedules.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={s.id === selectedId ? 'is-on' : ''}
                onClick={() => {
                  setSelectedId(s.id);
                  setSaved(false);
                  setError(null);
                }}
              >
                <span className="cal-sched-name">{s.name}</span>
                <span className="muted mono">
                  {s.timezone}
                  {s.isDefault ? ` · ${t('schedules.isDefault')}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-small" onClick={create} disabled={busy}>
          + {t('schedules.new')}
        </button>
      </aside>

      {!draft ? (
        <p className="muted">{t('schedules.empty')}</p>
      ) : (
        <section className="cal-sched-editor">
          <div className="form-grid">
            <label className="field">
              <span className="prop-label">{t('schedules.name')}</span>
              <input className="input" value={draft.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="field">
              <span className="prop-label">{t('schedules.timezone')}</span>
              <select className="select" value={draft.timezone} onChange={(e) => patch({ timezone: e.target.value })}>
                {(timezones.includes(draft.timezone) ? timezones : [draft.timezone, ...timezones]).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="checkbox-field cal-sched-default">
            <input
              type="checkbox"
              checked={draft.isDefault}
              disabled={draft.isDefault && schedules.length === 1}
              onChange={(e) => patch({ isDefault: e.target.checked })}
            />
            <span>{t('schedules.makeDefault')}</span>
          </label>
          <p className="muted mono cal-sched-usage">{t('schedules.usedBy', { n: draft.eventTypeCount })}</p>

          <p className="section-label">{t('schedules.weekly')}</p>
          <div className="cal-week">
            {DAYS.map((day) => {
              const ranges = draft.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.dayOfWeek === day);
              return (
                <div key={day} className="cal-week-row">
                  <label className="cal-week-day">
                    <input type="checkbox" checked={ranges.length > 0} onChange={(e) => setDayEnabled(day, e.target.checked)} />
                    <span>{t(`availability.day.${day}`)}</span>
                  </label>
                  <div className="cal-week-ranges">
                    {ranges.length === 0 ? (
                      <span className="muted">{t('schedules.unavailable')}</span>
                    ) : (
                      ranges.map(({ r, i }) => (
                        <div key={i} className="cal-range">
                          <input
                            className="input mono"
                            type="time"
                            value={r.startTime}
                            aria-label={`${t(`availability.day.${day}`)} start`}
                            onChange={(e) => updateRule(i, { startTime: e.target.value })}
                          />
                          <span className="muted" aria-hidden>
                            –
                          </span>
                          <input
                            className="input mono"
                            type="time"
                            value={r.endTime}
                            aria-label={`${t(`availability.day.${day}`)} end`}
                            onChange={(e) => updateRule(i, { endTime: e.target.value })}
                          />
                          <button
                            type="button"
                            className="cal-icon-btn cal-icon-danger"
                            onClick={() => removeRule(i)}
                            aria-label={t('common.remove')}
                            title={t('common.remove')}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  {ranges.length > 0 && (
                    <button
                      type="button"
                      className="cal-icon-btn"
                      onClick={() => addRange(day)}
                      aria-label={t('schedules.addRange')}
                      title={t('schedules.addRange')}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cal-sched-overrides-head">
            <p className="section-label">{t('schedules.overrides')}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={addOverride}>
              + {t('schedules.addOverride')}
            </button>
          </div>
          <p className="muted cal-sched-hint">{t('schedules.overridesHint')}</p>
          {draft.overrides.length === 0 ? (
            <p className="muted">{t('schedules.noOverrides')}</p>
          ) : (
            <div className="cal-overrides">
              {draft.overrides.map((o, i) => {
                const off = !o.startTime || !o.endTime;
                return (
                  <div key={i} className="cal-override-row">
                    <input
                      className="input mono"
                      type="date"
                      value={o.date}
                      onChange={(e) => updateOverride(i, { date: e.target.value })}
                    />
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={off}
                        onChange={(e) =>
                          updateOverride(
                            i,
                            e.target.checked ? { startTime: null, endTime: null } : { startTime: '09:00', endTime: '13:00' },
                          )
                        }
                      />
                      <span>{t('schedules.unavailable')}</span>
                    </label>
                    {off ? (
                      <span className="muted">{t('schedules.dayOff')}</span>
                    ) : (
                      <div className="cal-range">
                        <input
                          className="input mono"
                          type="time"
                          value={o.startTime ?? ''}
                          onChange={(e) => updateOverride(i, { startTime: e.target.value })}
                        />
                        <span className="muted" aria-hidden>
                          –
                        </span>
                        <input
                          className="input mono"
                          type="time"
                          value={o.endTime ?? ''}
                          onChange={(e) => updateOverride(i, { endTime: e.target.value })}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      className="cal-icon-btn cal-icon-danger"
                      onClick={() => removeOverride(i)}
                      aria-label={t('common.remove')}
                      title={t('common.remove')}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="form-error">{error}</p>}
          <div className="form-actions cal-sched-actions">
            <button type="button" className="btn btn-ghost btn-small btn-danger" onClick={remove} disabled={busy}>
              {t('common.delete')}
            </button>
            <button type="button" className="btn btn-solid" onClick={save} disabled={busy}>
              {busy ? t('common.saving') : saved ? t('common.saved') : t('common.save')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
