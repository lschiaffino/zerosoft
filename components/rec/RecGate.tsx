'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/** Video con contraseña: pide la clave y recarga la página ya desbloqueada. */
export default function RecGate({ shareId }: { shareId: string }) {
  const t = useTranslations('rec.watch');
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/v/${encodeURIComponent(shareId)}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.refresh();
      return;
    }
    setError(res?.status === 403 ? t('wrongPassword') : res?.status === 429 ? t('tooMany') : t('gateError'));
  }

  return (
    <form
      className="rec-gate-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="ui-field">
        <label className="label" htmlFor="rec-pw">
          {t('password')}
        </label>
        <input id="rec-pw" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="off" maxLength={200} />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || !pw} aria-busy={busy || undefined}>
        {t('unlock')}
      </button>
    </form>
  );
}
