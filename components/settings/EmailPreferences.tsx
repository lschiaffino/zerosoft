'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import { LIFECYCLE_CATEGORIES, type EmailPrefs, type LifecycleCategory } from '@/lib/lifecycle/types';

/**
 * Ajustes › Avisos: qué emails de zerosoft recibe la persona, por categoría,
 * más el resumen semanal (opcional) y la baja total. Los transaccionales no
 * se tocan desde acá.
 */
export default function EmailPreferences({ initial }: { initial: EmailPrefs }) {
  const t = useTranslations('settings.emailPrefs');
  const [prefs, setPrefs] = useState<EmailPrefs>(initial);

  /** Casilla marcada = la recibe. El digest es opt-in; el resto, opt-out. */
  const isOn = (c: LifecycleCategory) => (c === 'digest' ? prefs.digest : !prefs.optedOut.includes(c));
  const toggle = (c: LifecycleCategory, on: boolean) =>
    setPrefs((p) =>
      c === 'digest'
        ? { ...p, digest: on, optedOut: p.optedOut.filter((x) => x !== 'digest') }
        : { ...p, optedOut: on ? p.optedOut.filter((x) => x !== c) : [...p.optedOut, c] },
    );

  return (
    <FormSection
      id="emails"
      title={t('title')}
      description={t('desc')}
      onSubmit={async () => {
        const res = await fetch('/api/profile/email-preferences', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(prefs),
        }).catch(() => null);
        if (!res?.ok) return t('saveError');
        setPrefs((await res.json()) as EmailPrefs);
      }}
    >
      <fieldset className="st-fieldset st-email-prefs" disabled={prefs.unsubscribedAll} data-testid="email-prefs">
        <legend className="sr-only">{t('title')}</legend>
        {LIFECYCLE_CATEGORIES.map((c) => (
          <label key={c} className="ui-check st-email-pref" htmlFor={`ep-${c}`}>
            <input id={`ep-${c}`} type="checkbox" checked={!prefs.unsubscribedAll && isOn(c)} onChange={(e) => toggle(c, e.target.checked)} />
            <span>
              <span className="st-email-pref-label">{t(`categories.${c}.label`)}</span>
              <span className="ui-help st-email-pref-help">{t(`categories.${c}.help`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="ui-check st-email-pref st-email-pref-all" htmlFor="ep-all">
        <input id="ep-all" type="checkbox" checked={prefs.unsubscribedAll} onChange={(e) => setPrefs((p) => ({ ...p, unsubscribedAll: e.target.checked }))} />
        <span>
          <span className="st-email-pref-label">{t('all')}</span>
          <span className="ui-help st-email-pref-help">{t('allHelp')}</span>
        </span>
      </label>
    </FormSection>
  );
}
