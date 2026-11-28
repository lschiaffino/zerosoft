'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';

/**
 * Ajustes › Avisos: el resumen del día de Lines e Inbox por email, a la mañana
 * (lib/daily-brief.ts). Opcional: arranca apagado. Es de la persona, en
 * cualquier workspace.
 */
export default function DailyBriefEmail({ initial }: { initial: boolean }) {
  const t = useTranslations('settings.dailyBrief');
  const [on, setOn] = useState(initial);
  return (
    <FormSection
      setting="notifications-daily-brief"
      id="daily-brief"
      title={t('title')}
      description={t('desc')}
      onSubmit={async () => {
        const res = await fetch('/api/daily-brief', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: on, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }).catch(() => null);
        if (!res?.ok) return t('saveError');
        setOn(((await res.json()) as { email: boolean }).email);
      }}
    >
      <label className="ui-check st-email-pref" htmlFor="daily-brief-email">
        <input id="daily-brief-email" type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} data-testid="daily-brief-email" />
        <span>
          <span className="st-email-pref-label">{t('label')}</span>
          <span className="ui-help st-email-pref-help">{t('help')}</span>
        </span>
      </label>
    </FormSection>
  );
}
