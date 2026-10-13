'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import CopyButton from '@/components/link/CopyButton';

export interface CalendarSettingsValues {
  handle: string;
  timezone: string;
  weekStart: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeHours: number;
  maxBookingDays: number;
}

interface Props {
  initial: CalendarSettingsValues;
  origin: string;
  locale: string;
  canEditHandle: boolean;
}

/** Configuración de Cal: link público (handle), zona horaria y reglas por defecto. */
export default function CalendarSettingsForm({ initial, origin, locale, canEditHandle }: Props) {
  const t = useTranslations('calendar');
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [initial.timezone];
    }
  }, [initial.timezone]);

  const publicBase = `${origin}/${locale}/book/${values.handle}`;

  function setNum(key: keyof CalendarSettingsValues) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: Number(e.target.value) }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch('/api/calendar/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(canEditHandle ? values : { ...values, handle: undefined }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setSaved(true);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    setError(
      code === 'handle_taken'
        ? t('settings.handleTaken')
        : code === 'invalid_handle'
          ? t('settings.handleInvalid')
          : t('errors.generic'),
    );
  }

  return (
    <form className="calendar-form" onSubmit={onSubmit}>
      <section className="panel">
        <p className="section-label">{t('settings.publicLink')}</p>
        <label className="field">
          <span className="prop-label">{t('settings.handle')}</span>
          <input
            className="input mono"
            value={values.handle}
            onChange={(e) => setValues((v) => ({ ...v, handle: e.target.value.toLowerCase() }))}
            pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]"
            disabled={!canEditHandle}
            required
          />
        </label>
        <p className="muted">{t('settings.handleHint')}</p>
        <div className="calendar-public-link">
          <span className="mono">{publicBase}/…</span>
          <CopyButton text={publicBase} />
        </div>
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.defaults')}</p>
        <div className="form-grid">
          <label className="field">
            <span className="prop-label">{t('overview.timezone')}</span>
            <input
              className="input"
              list="zs-cal-timezones"
              value={values.timezone}
              onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
              required
            />
            <datalist id="zs-cal-timezones">
              {timezones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="prop-label">{t('settings.weekStart')}</span>
            <select className="input" value={values.weekStart} onChange={setNum('weekStart')}>
              {[1, 0, 6].map((d) => (
                <option key={d} value={d}>
                  {t(`availability.day.${d}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="prop-label">{t('settings.bufferBefore')}</span>
            <input className="input" type="number" min={0} value={values.bufferBeforeMin} onChange={setNum('bufferBeforeMin')} />
          </label>
          <label className="field">
            <span className="prop-label">{t('settings.bufferAfter')}</span>
            <input className="input" type="number" min={0} value={values.bufferAfterMin} onChange={setNum('bufferAfterMin')} />
          </label>
          <label className="field">
            <span className="prop-label">{t('settings.minNotice')}</span>
            <input className="input" type="number" min={0} value={values.minNoticeHours} onChange={setNum('minNoticeHours')} />
          </label>
          <label className="field">
            <span className="prop-label">{t('settings.maxDays')}</span>
            <input className="input" type="number" min={1} value={values.maxBookingDays} onChange={setNum('maxBookingDays')} />
          </label>
        </div>
      </section>

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-solid" disabled={busy}>
          {busy ? t('common.saving') : saved ? t('common.saved') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
