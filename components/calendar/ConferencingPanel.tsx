'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import type { HostConferencing } from '@/lib/calendar-locations';

/**
 * Links fijos de la persona logueada para las ubicaciones de los eventos:
 * su sala de Zoom, su link de Teams y su teléfono. Cuando un evento ofrece
 * Zoom o Teams sin link propio, la reserva lleva el de quien la atiende.
 */
export default function ConferencingPanel({ initial }: { initial: HostConferencing }) {
  const t = useTranslations('calendar');
  const id = useId();

  async function save(fd: FormData): Promise<string | undefined> {
    const res = await fetch('/api/calendar/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conferencing: {
          zoomUrl: String(fd.get('zoomUrl') ?? '').trim(),
          teamsUrl: String(fd.get('teamsUrl') ?? '').trim(),
          phone: String(fd.get('phone') ?? '').trim(),
        },
      }),
    }).catch(() => null);
    if (res?.ok) return undefined;
    return t('location.conferencingInvalid');
  }

  return (
    <FormSection title={t('location.conferencingTitle')} description={t('location.conferencingLead')} onSubmit={save}>
      <div className="ui-field">
        <label className="label" htmlFor={`${id}-zoom`}>
          {t('location.zoomLink')} <span className="ui-optional">{t('editor.optional')}</span>
        </label>
        <input
          id={`${id}-zoom`}
          name="zoomUrl"
          className="input data"
          type="url"
          inputMode="url"
          defaultValue={initial.zoomUrl ?? ''}
          placeholder="https://zoom.us/j/…"
        />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor={`${id}-teams`}>
          {t('location.teamsLink')} <span className="ui-optional">{t('editor.optional')}</span>
        </label>
        <input
          id={`${id}-teams`}
          name="teamsUrl"
          className="input data"
          type="url"
          inputMode="url"
          defaultValue={initial.teamsUrl ?? ''}
          placeholder="https://teams.microsoft.com/l/meetup-join/…"
        />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor={`${id}-phone`}>
          {t('location.phoneNumber')} <span className="ui-optional">{t('editor.optional')}</span>
        </label>
        <input
          id={`${id}-phone`}
          name="phone"
          className="input data"
          type="tel"
          autoComplete="tel"
          defaultValue={initial.phone ?? ''}
          placeholder="+54 11 5555 1234"
        />
        <p className="ui-help">{t('location.phoneNumberHelp')}</p>
      </div>
    </FormSection>
  );
}
