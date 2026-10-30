'use client';

import { useRef, useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';

/**
 * Entrar con un código por email (lib/email-login.ts), debajo del botón de
 * Google: email → "Mandar código" → se pega el código de 6 dígitos y entra.
 * En una invitación viene con el email invitado ya puesto.
 */
export default function EmailCodeForm({
  locale,
  callbackUrl,
  defaultEmail = '',
}: {
  locale: string;
  callbackUrl?: string;
  defaultEmail?: string;
}) {
  const t = useTranslations('common.auth.email');
  const [email, setEmail] = useState(defaultEmail);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch('/api/auth/email-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), locale }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(data.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic'));
      return;
    }
    const wasSent = sentTo !== null;
    setSentTo(email.trim().toLowerCase());
    setCode('');
    if (wasSent) setNotice(t('resent'));
    setTimeout(() => codeRef.current?.focus(), 0);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (busy || !sentTo) return;
    setBusy(true);
    setError(null);
    const target = callbackUrl ?? `/${locale}/app`;
    const res = await signIn('email-code', { email: sentTo, code: code.trim(), redirect: false, callbackUrl: target }).catch(() => null);
    if (!res || res.error || !res.ok) {
      setBusy(false);
      setError(t('errors.bad_code'));
      return;
    }
    window.location.assign(target);
  }

  if (!sentTo) {
    return (
      <form className="auth-email" onSubmit={requestCode} noValidate>
        <div className="auth-or" aria-hidden="true">
          <span>{t('or')}</span>
        </div>
        <label className="label" htmlFor="auth-email">
          {t('label')}
        </label>
        <input
          id="auth-email"
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('placeholder')}
          maxLength={254}
          required
        />
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-secondary btn-block" disabled={busy || !email.trim()} aria-busy={busy || undefined}>
          {busy ? t('sending') : t('send')}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-email" onSubmit={verify}>
      <p className="auth-email-sent" role="status">
        {t.rich('sent', { email: sentTo, b: (c) => <strong className="data">{c}</strong> })}
      </p>
      <label className="label" htmlFor="auth-code">
        {t('codeLabel')}
      </label>
      <input
        id="auth-code"
        ref={codeRef}
        className="input auth-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        required
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && <p className="ui-help">{notice}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.replace(/\D/g, '').length !== 6} aria-busy={busy || undefined}>
        {busy ? t('verifying') : t('verify')}
      </button>
      <div className="auth-email-actions">
        <button type="button" className="auth-link-btn" onClick={() => void requestCode()} disabled={busy}>
          {t('resend')}
        </button>
        <button
          type="button"
          className="auth-link-btn"
          onClick={() => {
            setSentTo(null);
            setError(null);
            setNotice(null);
          }}
          disabled={busy}
        >
          {t('changeEmail')}
        </button>
      </div>
    </form>
  );
}
