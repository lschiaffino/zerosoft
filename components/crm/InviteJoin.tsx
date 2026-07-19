'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/** Botón "Join team" de la página de invite: acepta y entra al workspace. */
export default function InviteJoin({ token }: { token: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch('/api/teams/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError(true);
      return;
    }
    router.push('/app/crm');
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-solid" disabled={busy} onClick={join}>
        {busy ? t('invite.joining') : t('invite.join')}
      </button>
      {error && <p className="form-error">{t('invite.joinError')}</p>}
    </>
  );
}
