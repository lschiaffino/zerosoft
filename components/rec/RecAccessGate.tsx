'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/** "Dejá tu email para ver": se guarda sin verificar y lo ve quien grabó el video. */
export function RecEmailGate({ shareId }: { shareId: string }) {
  const t = useTranslations('rec.watch');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/v/${encodeURIComponent(shareId)}/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.refresh();
      return;
    }
    setError(res?.status === 400 ? t('invalidEmail') : res?.status === 429 ? t('tooMany') : t('gateError'));
  }

  return (
    <form
      className="rec-gate-form"
      data-testid="rec-email-gate"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="ui-field">
        <label className="label" htmlFor="rec-gate-email">
          {t('email')}
        </label>
        <input id="rec-gate-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" maxLength={254} required />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="rec-gate-name">
          {t('nameOptional')}
        </label>
        <input id="rec-gate-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || !email} aria-busy={busy || undefined}>
        {t('continue')}
      </button>
    </form>
  );
}

/** Sin permiso, con una cuenta: pedirle acceso a quien grabó el video. */
export function RecRequestAccess({ shareId, initial }: { shareId: string; initial: string | null }) {
  const t = useTranslations('rec.watch');
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/v/${encodeURIComponent(shareId)}/request`, { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.status === 429 ? t('tooMany') : t('gateError'));
      return;
    }
    setStatus(((await res.json()) as { status: string }).status);
  }

  if (status === 'denied') return <p className="muted" data-testid="rec-request-denied">{t('requestDenied')}</p>;
  if (status) return <p role="status" data-testid="rec-request-sent">{t('requestSent')}</p>;
  return (
    <>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" onClick={() => void ask()} disabled={busy} aria-busy={busy || undefined} data-testid="rec-request-access">
        {t('requestAccess')}
      </button>
    </>
  );
}
