'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

/** Aceptar o rechazar un presupuesto desde el link. Aceptar pide el nombre de quien acepta. */
export default function PublicQuoteActions({ token, status, decidedName }: { token: string; status: string; decidedName: string }) {
  const t = useTranslations('books.public');
  const te = useTranslations('books.errors');
  const [state, setState] = useState(status);
  const [name, setName] = useState('');
  const [who, setWho] = useState(decidedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: 'accepted' | 'declined') => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/books/public/${encodeURIComponent(token)}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, name }) }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { status?: string; error?: string }) : { error: 'network' };
    setBusy(false);
    if (!res?.ok || !data.status) {
      const code = data.error ?? 'generic';
      return setError(te.has(code) ? te(code) : te('generic'));
    }
    setWho(name);
    setState(data.status);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void decide('accepted');
  };
  return (
    <aside className="bk-public-actions" aria-label={t('actions')}>
      {state === 'sent' ? (
        <form className="bk-public-decide" onSubmit={submit}>
          <label className="bk-public-field">
            <span className="bk-public-label">{t('yourName')}</span>
            <input className="input" required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {t('acceptQuote')}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => decide('declined')}>
            {t('declineQuote')}
          </button>
        </form>
      ) : (
        <p className={state === 'accepted' || state === 'invoiced' ? 'bk-public-ok' : 'bk-public-muted'} role="status">
          {state === 'declined' ? t('quoteDeclined') : state === 'expired' ? t('quoteExpired') : who ? t('quoteAcceptedBy', { name: who }) : t('quoteAccepted')}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
