'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import AdvancedSection from '@/components/ui/AdvancedSection';
import EmptyState from '@/components/ui/EmptyState';
import type { ScheduleDetail, ScheduleOverride, ScheduleRule } from '@/lib/calendar-schedules';
import { scheduleDisplayName } from '@/lib/calendar-schedule-name';
import CalIcon from './cal-icons';
import WeeklyHours from './WeeklyHours';
import { formatTimezone } from './cal-utils';

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

/**
 * Horarios reutilizables: lista a la izquierda, editor a la derecha con un
 * solo Guardar. Las excepciones por fecha van plegadas (con cuántas hay).
 */
export default function SchedulesView({ initial, defaultTimezone }: Props) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const baseId = useId();
  const defaultName = t('schedules.defaultName');
  const [schedules, setSchedules] = useState<Draft[]>(initial.map((s) => toDraft(s, defaultName)));
  const [saved, setSavedMap] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((s) => [s.id, JSON.stringify(toDraft(s, defaultName))])),
  );
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // La lista de zonas de Node y la del navegador no coinciden (alias, versiones de
  // ICU): el server y el primer render muestran solo UTC (más la zona del horario,
  // que el select agrega) y la lista completa llega después de montar, así la
  // hidratación no choca (mismo arreglo que CalendarSettingsForm).
  const [timezones, setTimezones] = useState<string[]>(['UTC']);
  useEffect(() => {
    try {
      setTimezones((Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'));
    } catch {
      // Sin soporte: queda UTC.
    }
  }, []);

  useEffect(() => {
    if (state !== 'saved') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const draft = schedules.find((s) => s.id === selectedId) ?? null;
  const dirty = draft ? JSON.stringify(draft) !== saved[draft.id] : false;
  const isDirty = (s: Draft) => JSON.stringify(s) !== saved[s.id];

  function patch(p: Partial<Draft>) {
    if (!draft) return;
    setSchedules((prev) => prev.map((s) => (s.id === draft.id ? { ...s, ...p } : s)));
    if (state !== 'saving') setState('idle');
  }

  async function readError(res: Response | null): Promise<string> {
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  }

  async function create() {
    setCreating(true);
    setError(null);
    const res = await fetch('/api/calendar/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: t('schedules.newName'), timezone: defaultTimezone }),
    }).catch(() => null);
    setCreating(false);
    if (res && res.status === 201) {
      const created = toDraft((await res.json()) as ScheduleDetail, defaultName);
      setSchedules((prev) => [...prev, created]);
      setSavedMap((prev) => ({ ...prev, [created.id]: JSON.stringify(created) }));
      setSelectedId(created.id);
      return;
    }
    setError(await readError(res));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || state === 'saving') return;
    if (draft.rules.some((r) => r.endTime <= r.startTime) || draft.overrides.some((o) => o.startTime && o.endTime && o.endTime <= o.startTime)) {
      setError(t('errors.invalid_range'));
      setState('error');
      return;
    }
    setState('saving');
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
    if (res && res.ok) {
      const updated = toDraft((await res.json()) as ScheduleDetail, defaultName);
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : updated.isDefault ? { ...s, isDefault: false } : s)));
      setSavedMap((prev) => {
        const next = { ...prev, [updated.id]: JSON.stringify(updated) };
        // El que dejó de ser el por defecto también queda guardado así.
        if (updated.isDefault) {
          for (const s of schedules) {
            if (s.id !== updated.id && s.isDefault) next[s.id] = JSON.stringify({ ...JSON.parse(prev[s.id]), isDefault: false });
          }
        }
        return next;
      });
      setState('saved');
      return;
    }
    setError(await readError(res));
    setState('error');
  }

  async function remove() {
    if (!draft || !confirm(t('schedules.deleteConfirm', { name: draft.name }))) return;
    setError(null);
    const res = await fetch(`/api/calendar/schedules/${draft.id}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      const rest = schedules.filter((s) => s.id !== draft.id);
      setSchedules(rest);
      setSelectedId(rest[0]?.id ?? null);
      return;
    }
    setError(await readError(res));
    setState('error');
  }

  function updateOverride(index: number, p: Partial<ScheduleOverride>) {
    if (!draft) return;
    patch({ overrides: draft.overrides.map((o, i) => (i === index ? { ...o, ...p } : o)) });
  }

  if (schedules.length === 0) {
    return (
      <EmptyState
        title={t('schedules.emptyTitle')}
        body={t('schedules.emptyBody')}
        action={
          <button type="button" className="btn btn-primary" onClick={create} aria-busy={creating || undefined}>
            {t('schedules.new')}
          </button>
        }
      />
    );
  }

  const idFor = (k: string) => `${baseId}-${k}`;
  const status =
    state === 'saving' ? t('common.saving') : state === 'saved' ? t('editor.saved') : state === 'error' ? error : dirty ? t('editor.unsaved') : null;

  return (
    <div className="cal-sched">
      <nav className="cal-sched-nav" aria-label={t('schedules.listLabel')}>
        <ul>
          {schedules.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="cal-sched-item"
                aria-current={s.id === selectedId ? 'true' : undefined}
                onClick={() => {
                  setSelectedId(s.id);
                  setState('idle');
                  setError(null);
                }}
              >
                <span className="cal-sched-name">
                  {s.name}
                  {isDirty(s) && <span className="cal-dirty" aria-label={t('editor.unsaved')} />}
                </span>
                <span className="cal-sched-meta">
                  <span>{formatTimezone(s.timezone, locale)}</span>
                  {s.isDefault && <span className="badge badge-ink">{t('schedules.isDefault')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-sm btn-block" onClick={create} aria-busy={creating || undefined}>
          <CalIcon name="plus" />
          {t('schedules.new')}
        </button>
      </nav>

      {draft && (
        <form className="ui-section cal-sched-editor" onSubmit={save} noValidate aria-label={draft.name}>
          <div className="ui-section-body">
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={idFor('name')}>
                  {t('schedules.name')}
                </label>
                <input id={idFor('name')} className="input" value={draft.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={idFor('tz')}>
                  {t('schedules.timezone')}
                </label>
                <select id={idFor('tz')} className="select" value={draft.timezone} onChange={(e) => patch({ timezone: e.target.value })}>
                  {(timezones.includes(draft.timezone) ? timezones : [draft.timezone, ...timezones]).map((tz) => (
                    <option key={tz} value={tz}>
                      {formatTimezone(tz, locale)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="cal-sched-flags">
              <label className="ui-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.isDefault}
                  disabled={draft.isDefault && saved[draft.id]?.includes('"isDefault":true')}
                  onChange={(e) => patch({ isDefault: e.target.checked })}
                />
                <span>{t('schedules.makeDefault')}</span>
              </label>
              <span className="ui-help">{t('schedules.usedBy', { n: draft.eventTypeCount })}</span>
            </div>

            <div className="cal-sub">
              <div className="cal-sub-head">
                <h2 className="cal-sub-title">{t('schedules.weekly')}</h2>
              </div>
              <WeeklyHours rules={draft.rules} onChange={(rules) => patch({ rules })} />
            </div>

            <AdvancedSection
              key={draft.id}
              storageKey="cal.overrides"
              label={t('schedules.overrides')}
              hint={t('schedules.overridesCount', { n: draft.overrides.length })}
            >
              <p className="ui-help">{t('schedules.overridesHint')}</p>
              {draft.overrides.length > 0 && (
                <div className="cal-overrides">
                  {draft.overrides.map((o, i) => {
                    const off = !o.startTime || !o.endTime;
                    return (
                      <div key={i} className="cal-override-row">
                        <input
                          className="input data"
                          type="date"
                          value={o.date}
                          aria-label={t('schedules.overrideDate', { n: i + 1 })}
                          onChange={(e) => updateOverride(i, { date: e.target.value })}
                        />
                        <label className="ui-check">
                          <input
                            type="checkbox"
                            checked={off}
                            onChange={(e) =>
                              updateOverride(i, e.target.checked ? { startTime: null, endTime: null } : { startTime: '09:00', endTime: '13:00' })
                            }
                          />
                          <span>{t('schedules.blockDay')}</span>
                        </label>
                        {off ? (
                          <span className="cal-week-off">{t('schedules.dayOff')}</span>
                        ) : (
                          <div className="cal-range">
                            <input
                              className="input data"
                              type="time"
                              value={o.startTime ?? ''}
                              aria-label={t('schedules.overrideStart', { n: i + 1 })}
                              onChange={(e) => updateOverride(i, { startTime: e.target.value })}
                            />
                            <span className="cal-range-sep" aria-hidden="true" />
                            <input
                              className="input data"
                              type="time"
                              value={o.endTime ?? ''}
                              aria-label={t('schedules.overrideEnd', { n: i + 1 })}
                              onChange={(e) => updateOverride(i, { endTime: e.target.value })}
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => patch({ overrides: draft.overrides.filter((_, j) => j !== i) })}
                          aria-label={t('schedules.removeOverride', { n: i + 1 })}
                          title={t('common.remove')}
                        >
                          <CalIcon name="close" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => patch({ overrides: [...draft.overrides, { date: today(), startTime: null, endTime: null }] })}
                >
                  <CalIcon name="plus" />
                  {t('schedules.addOverride')}
                </button>
              </div>
            </AdvancedSection>
          </div>
          <div className="ui-section-foot">
            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={remove} disabled={draft.isDefault}>
              {t('schedules.delete')}
            </button>
            <p
              className="ui-section-note cal-foot-note"
              role="status"
              aria-live="polite"
              data-tone={state === 'saved' ? 'ok' : state === 'error' ? 'error' : undefined}
            >
              {status}
            </p>
            <button type="submit" className="btn btn-primary" aria-busy={state === 'saving' || undefined} disabled={!dirty && state !== 'error'}>
              {t('editor.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
