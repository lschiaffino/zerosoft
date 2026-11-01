'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

async function send<T>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

/**
 * Invita al workspace desde Track. Para sumar a un team, la persona primero
 * tiene que estar en el workspace. Si el email no sale, la invitación igual
 * queda creada: se ofrece su link para mandarlo a mano.
 */
export default function WorkspaceInviteForm({ onInvited }: { onInvited?: () => void }) {
  const t = useTranslations('track');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<string[]>([]);

  const loadPending = useCallback(async () => {
    const res = await send<{ rows: Array<{ email: string; expired: boolean }> }>('/api/teams/invites', 'GET').catch(() => null);
    if (res?.ok) setPending(res.data.rows.filter((r) => !r.expired).map((r) => r.email));
  }, []);
  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setError(null);
    setNotice(null);
    setLink(null);
    setCopied(false);
    setBusy(true);
    const res = await send<{ results?: Array<{ email: string; status: string; url?: string }> }>('/api/teams/invites', 'POST', { emails: value, role: 'member' }).catch(() => null);
    setBusy(false);
    const first = res?.ok ? res.data.results?.[0] : undefined;
    if (first?.status === 'sent') {
      setNotice(t('access.inviteSent', { email: value }));
      setEmail('');
    } else if (first?.status === 'member') {
      setNotice(t('access.inviteAlreadyMember', { email: value }));
      setEmail('');
    } else {
      setError(res?.status === 429 || first?.status === 'limited' ? t('access.inviteLimited') : res?.status === 400 ? t('access.inviteInvalid') : t('access.inviteFailed'));
      if (first?.url) setLink(first.url);
    }
    void loadPending();
    onInvited?.();
  };

  return (
    <>
      {error ? (
        <p className="ui-error" role="alert">
          {error}{' '}
          {link ? (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="track-access-invite-copy"
              onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
            >
              {copied ? t('access.inviteCopied') : t('access.inviteCopy')}
            </button>
          ) : null}
        </p>
      ) : null}
      <form className="track-int-row" onSubmit={(e) => void submit(e)}>
        <input
          type="email"
          className="input track-access-invite-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('access.invitePlaceholder')}
          aria-label={t('access.inviteTitle')}
          required
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
          {t('access.inviteButton')}
        </button>
      </form>
      {notice ? (
        <p className="ui-help" role="status" data-testid="track-access-invited">
          {notice}
        </p>
      ) : null}
      {pending.length > 0 ? (
        <p className="ui-help" data-testid="track-access-pending">
          {t('access.invitesPending', { emails: pending.join(', ') })}
        </p>
      ) : null}
    </>
  );
}
