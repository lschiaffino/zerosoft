'use client';

import { useState, type FormEvent } from 'react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';

/** Segundo paso del login: código del autenticador o, si no lo tiene a mano, uno de recuperación. */
export default function MfaForm({ target }: { target: string }) {
  const t = useTranslations('common.auth.mfa');
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = recovery ? code.replace(/[^a-z2-7]/gi, '').length === 12 : code.replace(/\D/g, '').length === 6;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/mfa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setBusy(false);
      setError(body?.error === 'rate_limited' ? t('errors.rate_limited') : res?.status === 401 ? t('errors.expired') : res ? t('errors.bad_code') : t('errors.network'));
      return;
    }
    window.location.assign(target);
  }

  return (
    <form className="auth-email" onSubmit={submit} data-testid="mfa-form">
      <label className="label" htmlFor="mfa-code">
        {recovery ? t('recoveryLabel') : t('codeLabel')}
      </label>
      <input
        id="mfa-code"
        className="input auth-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode={recovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        maxLength={recovery ? 14 : 7}
        placeholder={recovery ? 'xxxx-xxxx-xxxx' : '123456'}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'mfa-error' : undefined}
      />
      {error && (
        <p className="ui-error" role="alert" id="mfa-error">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !ready} aria-busy={busy || undefined}>
        {busy ? t('verifying') : t('verify')}
      </button>
      <div className="auth-email-actions">
        <button
          type="button"
          className="auth-link-btn"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
            setError(null);
          }}
        >
          {recovery ? t('useApp') : t('useRecovery')}
        </button>
        <button type="button" className="auth-link-btn" onClick={() => void signOut({ callbackUrl: '/' })}>
          {t('signOut')}
        </button>
      </div>
    </form>
  );
}
