'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** Setting del workspace: tracking de aperturas/clicks en emails del CRM (solo admins). */
export default function EmailTrackingSetting({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const t = useTranslations('crm');
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(false);
    setOn(next);
    const res = await fetch('/api/crm/email-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackingEnabled: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setOn(!next);
      setError(true);
    }
  }

  return (
    <div className="em-setting">
      <label className="em-check">
        <input type="checkbox" checked={on} disabled={!canEdit || busy} onChange={(e) => toggle(e.target.checked)} />
        {t('settings.trackingOn')}
      </label>
      {!canEdit && <p className="ui-help">{t('settings.trackingAdminOnly')}</p>}
      {error && <p className="form-error">{t('errors.generic')}</p>}
    </div>
  );
}
