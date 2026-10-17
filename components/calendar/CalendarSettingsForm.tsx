'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import CalCopyButton from './CalCopyButton';
import { brandOr, formatTimezone, safeLogo, textOn } from './cal-utils';

export interface CalendarSettingsValues {
  handle: string;
  timezone: string;
  weekStart: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeHours: number;
  maxBookingDays: number;
  /** Marca del workspace ('' = sin valor). */
  brandColor: string;
  logoUrl: string;
  displayName: string;
}

interface Props {
  initial: CalendarSettingsValues;
  /** Nombre de la cuenta: el que se usa si no hay nombre visible. */
  accountName: string;
  origin: string;
  locale: string;
  canEditHandle: boolean;
}

/**
 * Perfil de Cal: el link público (handle), la marca del workspace que llevan
 * todas las páginas públicas y, aparte, la zona horaria y los límites que usan
 * los tipos de evento que no definen los suyos. Cada bloque tiene su Guardar.
 */
export default function CalendarSettingsForm({ initial, accountName, origin, locale, canEditHandle }: Props) {
  const t = useTranslations('calendar');
  const id = useId();
  const [handle, setHandle] = useState(initial.handle);
  const [brandColor, setBrandColor] = useState(initial.brandColor);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const shownColor = brandOr(brandColor, '#111111');
  const shownName = displayName.trim() || accountName;
  const shownLogo = safeLogo(logoUrl);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [initial.timezone];
    }
  }, [initial.timezone]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/calendar/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) return;
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    return code === 'handle_taken'
      ? t('settings.handleTaken')
      : code === 'invalid_handle'
        ? t('settings.handleInvalid')
        : code === 'invalid_timezone'
          ? t('settings.timezoneInvalid')
          : code === 'forbidden'
            ? t('payments.adminOnly')
            : t('errors.generic');
  }

  const publicBase = `${origin}/${locale}/book/${handle}`;
  const num = (fd: FormData, k: string, min: number) => Math.max(min, Math.round(Number(fd.get(k)) || 0));

  return (
    <>
      <FormSection
        title={t('settings.publicLink')}
        description={t('settings.handleHint')}
        onSubmit={canEditHandle ? () => post({ handle }) : undefined}
        footer={canEditHandle ? undefined : <p className="ui-section-note">{t('payments.adminOnly')}</p>}
      >
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-handle`}>
            {t('settings.handle')}
          </label>
          <div className="ui-input-group">
            <span className="ui-addon">/{locale}/book/</span>
            <input
              id={`${id}-handle`}
              className="input data"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              minLength={3}
              maxLength={32}
              disabled={!canEditHandle}
              required
            />
          </div>
        </div>
        <div className="cal-share-url">
          <span className="data">{publicBase}</span>
          <CalCopyButton text={publicBase} />
        </div>
      </FormSection>

      <FormSection
        title={t('settings.brandTitle')}
        description={t('settings.brandLead')}
        onSubmit={
          canEditHandle
            ? () => {
                if (logoUrl.trim() && !safeLogo(logoUrl)) return t('editor.logoInvalid');
                return post({ brandColor: brandColor || null, logoUrl: logoUrl.trim() || null, displayName: displayName.trim() || null });
              }
            : undefined
        }
        footer={canEditHandle ? undefined : <p className="ui-section-note">{t('payments.adminOnly')}</p>}
      >
        <div className="cal-brand">
          <div className="cal-brand-fields">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-name`}>
                {t('settings.displayName')}
              </label>
              <input
                id={`${id}-name`}
                className="input"
                value={displayName}
                maxLength={80}
                placeholder={accountName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!canEditHandle}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-color`}>
                {t('form.brandColor')}
              </label>
              <div className="cal-color">
                <input
                  id={`${id}-color`}
                  type="color"
                  className="cal-color-input"
                  value={shownColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  disabled={!canEditHandle}
                />
                {brandColor ? <span className="data">{shownColor.toUpperCase()}</span> : <span className="cal-muted">{t('settings.noColor')}</span>}
                {brandColor && canEditHandle && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBrandColor('')}>
                    {t('settings.clearColor')}
                  </button>
                )}
              </div>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-logo`}>
                {t('form.logoUrl')} <span className="ui-optional">{t('editor.optional')}</span>
              </label>
              <input
                id={`${id}-logo`}
                className="input data"
                value={logoUrl}
                placeholder="https://…/logo.svg"
                onChange={(e) => setLogoUrl(e.target.value)}
                disabled={!canEditHandle}
              />
              <p className="ui-help">{t('settings.logoHelp')}</p>
            </div>
          </div>
          <figure className="cal-brand-sample" style={{ borderTopColor: shownColor }}>
            <figcaption className="cal-brand-sample-cap">{t('editor.preview')}</figcaption>
            <div className="cal-brand-sample-host">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownLogo} alt="" className="cal-brand-sample-logo" />
              ) : (
                <span className="cal-brand-sample-mono" style={{ background: shownColor, color: textOn(shownColor) }} aria-hidden="true">
                  {shownName.trim().slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="cal-brand-sample-name">{shownName}</span>
            </div>
            <span className="cal-brand-preview" style={{ background: shownColor, color: textOn(shownColor) }}>
              {t('booking.confirm')}
            </span>
          </figure>
        </div>
      </FormSection>

      <FormSection
        title={t('settings.defaults')}
        description={t('settings.defaultsLead')}
        onSubmit={(fd) =>
          post({
            timezone: String(fd.get('timezone') ?? '').trim(),
            weekStart: Number(fd.get('weekStart')),
            bufferBeforeMin: num(fd, 'bufferBeforeMin', 0),
            bufferAfterMin: num(fd, 'bufferAfterMin', 0),
            minNoticeHours: num(fd, 'minNoticeHours', 0),
            maxBookingDays: num(fd, 'maxBookingDays', 1),
          })
        }
      >
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-tz`}>
              {t('overview.timezone')}
            </label>
            <select id={`${id}-tz`} name="timezone" className="select" defaultValue={initial.timezone}>
              {(timezones.includes(initial.timezone) ? timezones : [initial.timezone, ...timezones]).map((tz) => (
                <option key={tz} value={tz}>
                  {formatTimezone(tz, locale)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-week`}>
              {t('settings.weekStart')}
            </label>
            <select id={`${id}-week`} name="weekStart" className="select" defaultValue={initial.weekStart}>
              {[1, 0, 6].map((d) => (
                <option key={d} value={d}>
                  {t(`availability.day.${d}`)}
                </option>
              ))}
            </select>
          </div>
          {(
            [
              ['bufferBeforeMin', t('settings.bufferBefore'), 'min', 0, initial.bufferBeforeMin],
              ['bufferAfterMin', t('settings.bufferAfter'), 'min', 0, initial.bufferAfterMin],
              ['minNoticeHours', t('settings.minNotice'), 'h', 0, initial.minNoticeHours],
              ['maxBookingDays', t('settings.maxDays'), t('editor.daysUnit'), 1, initial.maxBookingDays],
            ] as Array<[string, string, string, number, number]>
          ).map(([k, label, unit, min, value]) => (
            <div key={k} className="ui-field">
              <label className="label" htmlFor={`${id}-${k}`}>
                {label}
              </label>
              <div className="ui-input-group">
                <input id={`${id}-${k}`} name={k} className="input cal-num" type="number" min={min} defaultValue={value} />
                <span className="ui-addon cal-unit">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </FormSection>
    </>
  );
}
