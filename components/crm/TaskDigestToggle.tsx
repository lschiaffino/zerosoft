'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** El email diario con las tareas del día (como el digest de HubSpot): lo activa cada persona para sí. */
export default function TaskDigestToggle({ enabled }: { enabled: boolean }) {
  const t = useTranslations('crm');
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    setOn(next);
    const res = await fetch('/api/crm/tasks/digest', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) setOn(!next);
  }

  return (
    <label className="btn btn-secondary btn-sm task-digest-toggle" title={t('tasks.digest.hint')}>
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} data-testid="task-digest-toggle" />
      <span>{t('tasks.digest.label')}</span>
    </label>
  );
}
