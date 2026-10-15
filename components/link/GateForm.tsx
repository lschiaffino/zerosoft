'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface GateFormProps {
  slug: string;
  /** La visita vino del QR (?qr=1): se reenvía para contarla como escaneo. */
  qr?: boolean;
}

/** Password form for protected links; on success navigates to /<slug>. */
export default function GateForm({ slug, qr = false }: GateFormProps) {
  const t = useTranslations('link');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, password }),
      });
      if (res.ok) {
        // Full reload so the redirect handler sees the freshly-set gate cookie.
        window.location.href = `/${slug}${qr ? '?qr=1' : ''}`;
        return;
      }
      setError(res.status === 401 ? t('gate.wrongPassword') : t('gate.error'));
      setBusy(false);
    } catch {
      setError(t('gate.error'));
      setBusy(false);
    }
  }

  return (
    <form className="gate-form" onSubmit={onSubmit}>
      <label className="label" htmlFor="gate-pw">{t('gate.passwordLabel')}</label>
      <input
        id="gate-pw"
        className="input mono"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        autoComplete="off"
      />
      {error && <p className="form-error mono">{error}</p>}
      <button type="submit" className="btn btn-solid gate-submit" disabled={busy || !password}>
        {t('gate.submit')}
      </button>
    </form>
  );
}
