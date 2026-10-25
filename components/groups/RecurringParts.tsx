'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { POLL_MAX_OPTIONS, type PollDto } from '@/lib/groups-polls';
import { normalizeRule, upcomingRuns, type RecurrenceRule } from '@/lib/groups-recurrence';

export const DEFAULT_RULE: RecurrenceRule = { freq: 'weekly', time: '09:00', days: [1], dayOfMonth: 1, cron: '' };

/** Zona horaria del navegador (o UTC). */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Fecha de fin (YYYY-MM-DD, local) → fin de ese día en ISO, o null. */
export function endsIso(endsAt: string): string | null {
  if (!endsAt) return null;
  const t = new Date(`${endsAt}T23:59:59`).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Regla válida o el código de error (para mostrarlo debajo). */
export function checkRule(rule: RecurrenceRule): string | null {
  try {
    normalizeRule(rule);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Campos de la repetición: diario, semanal (días), mensual (día del mes) o
 * cron, hora, zona, fin opcional, y las próximas 3 corridas.
 */
export function RecurrenceFields({
  rule,
  onChange,
  timezone,
  onTimezone,
  endsAt,
  onEndsAt,
}: {
  rule: RecurrenceRule;
  onChange: (r: RecurrenceRule) => void;
  timezone: string;
  onTimezone: (tz: string) => void;
  endsAt: string;
  onEndsAt: (v: string) => void;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const error = checkRule(rule);
  const next = useMemo(() => {
    if (error) return [];
    try {
      return upcomingRuns(normalizeRule(rule), timezone, new Date(), 3, endsIso(endsAt));
    } catch {
      return [];
    }
  }, [rule, timezone, endsAt, error]);
  const dayNames = useMemo(() => {
    const base = new Date(Date.UTC(2026, 0, 4)); // domingo
    return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 86_400_000).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }));
  }, [locale]);
  const zones = useMemo(() => {
    try {
      const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
      return list.includes(timezone) ? list : [timezone, ...list];
    } catch {
      return [timezone];
    }
  }, [timezone]);

  return (
    <div className="ui-fields gr-recurrence">
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('recurring.repeat')}</span>
          <select className="select" value={rule.freq} onChange={(e) => onChange({ ...rule, freq: e.target.value as RecurrenceRule['freq'] })}>
            {(['daily', 'weekly', 'monthly', 'cron'] as const).map((f) => (
              <option key={f} value={f}>
                {t(`recurring.freq.${f}`)}
              </option>
            ))}
          </select>
        </label>
        {rule.freq !== 'cron' ? (
          <label className="ui-field">
            <span className="label">{t('recurring.time')}</span>
            <input className="input gr-narrow" type="time" value={rule.time} onChange={(e) => onChange({ ...rule, time: e.target.value })} required />
          </label>
        ) : (
          <label className="ui-field">
            <span className="label">{t('recurring.cron')}</span>
            <input className="input gr-mono" value={rule.cron} onChange={(e) => onChange({ ...rule, cron: e.target.value })} placeholder="0 9 * * 1-5" />
            <span className="ui-help">{t('recurring.cronHelp')}</span>
          </label>
        )}
      </div>
      {rule.freq === 'weekly' && (
        <fieldset className="ui-field">
          <legend className="label">{t('recurring.days')}</legend>
          <div className="gr-days">
            {dayNames.map((d, i) => (
              <label key={i} className="gr-check-label">
                <input
                  type="checkbox"
                  className="ui-check"
                  checked={rule.days.includes(i)}
                  onChange={() => onChange({ ...rule, days: rule.days.includes(i) ? rule.days.filter((x) => x !== i) : [...rule.days, i].sort() })}
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {rule.freq === 'monthly' && (
        <label className="ui-field">
          <span className="label">{t('recurring.dayOfMonth')}</span>
          <input
            className="input gr-narrow"
            type="number"
            min={1}
            max={31}
            value={rule.dayOfMonth}
            onChange={(e) => onChange({ ...rule, dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
          />
          <span className="ui-help">{t('recurring.dayOfMonthHelp')}</span>
        </label>
      )}
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('recurring.timezone')}</span>
          <select className="select" value={timezone} onChange={(e) => onTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field">
          <span className="label">{t('recurring.endsAt')}</span>
          <input className="input" type="date" value={endsAt} onChange={(e) => onEndsAt(e.target.value)} />
          <span className="ui-help">{t('recurring.endsAtHelp')}</span>
        </label>
      </div>
      {error ? (
        <p className="ui-error" role="alert">
          {t(`errors.${error}`)}
        </p>
      ) : (
        <p className="ui-help" role="status">
          {next.length ? t('recurring.next', { list: next.map((d) => d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone })).join(' · ') }) : t('recurring.noNext')}
        </p>
      )}
    </div>
  );
}

/** Pregunta, opciones (2 a 12) y "varias respuestas". */
export function PollFields({
  question,
  options,
  multi,
  onChange,
  idPrefix = 'poll',
}: {
  question: string;
  options: string[];
  multi: boolean;
  onChange: (v: { question: string; options: string[]; multi: boolean }) => void;
  idPrefix?: string;
}) {
  const t = useTranslations('groups');
  const set = (patch: Partial<{ question: string; options: string[]; multi: boolean }>) => onChange({ question, options, multi, ...patch });
  return (
    <div className="ui-fields gr-poll-fields">
      <label className="ui-field">
        <span className="label">{t('polls.question')}</span>
        <input className="input" value={question} onChange={(e) => set({ question: e.target.value })} maxLength={255} placeholder={t('polls.questionPlaceholder')} />
      </label>
      <fieldset className="ui-field">
        <legend className="label">{t('polls.options')}</legend>
        {options.map((o, i) => (
          <div key={`${idPrefix}-${i}`} className="gr-inline-form">
            <input
              className="input"
              value={o}
              onChange={(e) => set({ options: options.map((x, j) => (j === i ? e.target.value : x)) })}
              maxLength={100}
              aria-label={t('polls.optionN', { n: i + 1 })}
              placeholder={t('polls.optionN', { n: i + 1 })}
            />
            {options.length > 2 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ options: options.filter((_, j) => j !== i) })} aria-label={t('polls.removeOption', { n: i + 1 })}>
                {t('common.remove')}
              </button>
            )}
          </div>
        ))}
        {options.length < POLL_MAX_OPTIONS && (
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ options: [...options, ''] })}>
              {t('polls.addOption')}
            </button>
          </div>
        )}
      </fieldset>
      <label className="gr-check-label">
        <input type="checkbox" className="ui-check" checked={multi} onChange={(e) => set({ multi: e.target.checked })} />
        {t('polls.multi')}
      </label>
    </div>
  );
}

/** Resultados de una encuesta (barras con el porcentaje). */
export function PollResults({ poll }: { poll: PollDto }) {
  const t = useTranslations('groups');
  const max = Math.max(1, ...poll.results.map((r) => r.votes));
  return (
    <div className="gr-poll" role="group" aria-label={t('polls.aria', { question: poll.question })}>
      <p className="gr-poll-q">
        <strong>{poll.question}</strong>
      </p>
      <ul className="gr-poll-results">
        {poll.results.map((r) => (
          <li key={r.option}>
            <span className="gr-poll-label">
              <span>{r.option}</span>
              <span className="num">{r.votes}</span>
            </span>
            <span className="gr-poll-bar" aria-hidden="true">
              <i style={{ width: `${(r.votes / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="ui-help">
        {t('polls.voters', { n: poll.voters })}
        {poll.multi ? ` · ${t('polls.multiShort')}` : ''}
      </p>
    </div>
  );
}

/** Texto corto de una regla ("Semanal: lun, mié a las 09:00"). */
export function useRuleText() {
  const t = useTranslations('groups');
  const locale = useLocale();
  return (rule: RecurrenceRule) => {
    if (rule.freq === 'cron') return `${t('recurring.freq.cron')}: ${rule.cron}`;
    if (rule.freq === 'daily') return t('recurring.textDaily', { time: rule.time });
    if (rule.freq === 'monthly') return t('recurring.textMonthly', { day: rule.dayOfMonth, time: rule.time });
    const base = new Date(Date.UTC(2026, 0, 4));
    const days = rule.days.map((d) => new Date(base.getTime() + d * 86_400_000).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })).join(', ');
    return t('recurring.textWeekly', { days, time: rule.time });
  };
}
