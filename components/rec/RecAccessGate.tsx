'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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

/** Link mágico de una invitación: un clic lo usa y abre el video. Si ya se usó o venció, se pide uno nuevo. */
export function RecOpenInvite({ shareId, token }: { shareId: string; token: string }) {
  const t = useTranslations('rec.watch');
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'used' | 'error'>('idle');

  async function open() {
    setState('busy');
    const res = await fetch(`/api/rec/v/${encodeURIComponent(shareId)}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (res?.ok) {
      router.replace(`/v/${shareId}`);
      router.refresh();
      return;
    }
    setState(res?.status === 410 ? 'used' : 'error');
  }

  if (state === 'used') {
    return (
      <>
        <p className="ui-error" role="alert" data-testid="rec-invite-used">
          {t('inviteUsed')}
        </p>
        <RecMagicLink shareId={shareId} />
      </>
    );
  }
  return (
    <>
      {state === 'error' && (
        <p className="ui-error" role="alert">
          {t('gateError')}
        </p>
      )}
      <button type="button" className="btn btn-primary" onClick={() => void open()} disabled={state === 'busy'} aria-busy={state === 'busy' || undefined} data-testid="rec-invite-open" autoFocus>
        {t('openVideo')}
      </button>
    </>
  );
}

/**
 * Sin acceso: escribir el email. Si está invitado le llega un link para
 * entrar; si no, le llega el pedido a quien grabó. Mismo mensaje en los dos casos.
 */
export function RecMagicLink({ shareId }: { shareId: string }) {
  const t = useTranslations('rec.watch');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/v/${encodeURIComponent(shareId)}/access`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name, locale }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setSent(true);
      return;
    }
    setError(res?.status === 400 ? t('invalidEmail') : res?.status === 429 ? t('tooMany') : t('gateError'));
  }

  if (sent) {
    return (
      <p role="status" className="rec-gate-sent" data-testid="rec-magic-sent">
        {t('magicSent')}
      </p>
    );
  }
  return (
    <form
      className="rec-gate-form rec-gate-magic"
      data-testid="rec-magic-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="label">{t('magicTitle')}</p>
      <p className="ui-help">{t('magicHelp')}</p>
      <div className="ui-field">
        <label className="label" htmlFor="rec-magic-email">
          {t('email')}
        </label>
        <input id="rec-magic-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="rec-magic-name">
          {t('nameOptional')}
        </label>
        <input id="rec-magic-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-secondary" disabled={busy || !email} aria-busy={busy || undefined} data-testid="rec-magic-submit">
        {t('magicSend')}
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
