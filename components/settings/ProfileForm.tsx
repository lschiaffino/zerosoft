'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';

function zones(current: string): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
}

/** Ajustes › Perfil: nombre, idioma y zona horaria (el nombre editado no lo pisa el de Google). */
export default function ProfileForm({ name, locale, timeZone }: { name: string; locale: string; timeZone: string }) {
  const t = useTranslations('settings.profileForm');
  const [tz, setTz] = useState(timeZone);
  const list = useMemo(() => zones(tz), [tz]);

  return (
    <FormSection
      title={t('title')}
      description={t('desc')}
      onSubmit={async (fd) => {
        const lang = String(fd.get('locale') ?? locale);
        const res = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: String(fd.get('name') ?? ''), locale: lang, timeZone: tz }),
        }).catch(() => null);
        if (!res?.ok) return t('error');
        if (lang !== locale) window.location.assign(window.location.pathname.replace(/^\/(en|es|pt)(?=\/|$)/, `/${lang}`));
      }}
    >
      <div className="ui-fields ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="pf-name">
            {t('name')}
          </label>
          <input id="pf-name" name="name" className="input" defaultValue={name} maxLength={80} autoComplete="name" />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="pf-locale">
            {t('language')}
          </label>
          <select id="pf-locale" name="locale" className="select" defaultValue={locale}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="pf-tz">
            {t('timeZone')}
          </label>
          <select id="pf-tz" className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
            {list.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>
    </FormSection>
  );
}
