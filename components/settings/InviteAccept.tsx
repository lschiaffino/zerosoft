'use client';

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { clearOfflineData } from '@/lib/offline-queue';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/**
 * Aceptar una invitación (página /invite/[token]). Si la sesión es de otro
 * email, pide confirmar antes de sumar esa cuenta o entrar con otra.
 */
export default function InviteAccept({
  token,
  workspace,
  mismatch,
  strict = false,
  inviteEmail,
  email,
  locale,
  demo,
}: {
  token: string;
  workspace: string;
  mismatch: boolean;
  /** Solo se acepta con el email invitado (por defecto, y siempre para admins). */
  strict?: boolean;
  inviteEmail: string;
  email: string;
  locale: string;
  demo: boolean;
}) {
  const t = useTranslations('settings.invite');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si la revocaron o venció con la página abierta, al volver a la pestaña ya no se ofrece sumarse.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [router]);

  async function join(confirm: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/teams/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, confirm }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { next?: string; error?: string }) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(data.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic'));
      // Ya no sirve: la página pasa a decirlo y saca el botón.
      if (data.error === 'invite_invalid' || data.error === 'invite_expired') router.refresh();
      return;
    }
    router.push(data.next ?? '/app');
    router.refresh();
  }

  const other = !demo && (
    <button
      type="button"
      className={`btn ${strict ? 'btn-primary' : 'btn-secondary'} btn-block`}
      disabled={busy}
      onClick={() => void clearOfflineData().finally(() => signOut({ callbackUrl: `/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}/invite/${token}`)}` }))}
    >
      {t('otherAccount')}
    </button>
  );

  if (mismatch && strict) {
    return (
      <div className="ws-accept">
        <p className="ws-accept-warn" role="note">
          {t.rich('mismatchStrict', { invited: inviteEmail, current: email, b: (c) => <strong className="data">{c}</strong> })}
        </p>
        {other}
      </div>
    );
  }

  if (mismatch) {
    return (
      <div className="ws-accept">
        <p className="ws-accept-warn" role="note">
          {t.rich('mismatch', { invited: inviteEmail, current: email, b: (c) => <strong className="data">{c}</strong> })}
        </p>
        <button type="button" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy || undefined} onClick={() => void join(true)}>
          {t('joinAs', { email })}
        </button>
        {other}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="ws-accept">
      <button type="button" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy || undefined} onClick={() => void join(false)}>
        {busy ? t('joining') : t('join', { workspace })}
      </button>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
