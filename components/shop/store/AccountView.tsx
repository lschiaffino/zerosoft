'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useMounted } from '@/components/ui/useMounted';
import { formatMoney } from '@/lib/shop-money';
import type { AccountOrder } from '@/lib/shop-pages';
import type { StorefrontStrings } from '@/lib/shop-i18n';

/** "Mis pedidos" sin contraseña: pide el email, manda un link y muestra el historial mientras el link siga vigente. */
export default function AccountView({ handle, token, locale, t }: { handle: string; token: string | null; locale: string; t: StorefrontStrings }) {
  const mounted = useMounted();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ email: string; orders: AccountOrder[] } | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!token) return;
    void fetch(`/api/shop/public/${handle}/account?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return setExpired(true);
        setData((await res.json()) as { email: string; orders: AccountOrder[] });
      })
      .catch(() => setExpired(true));
  }, [handle, token]);
  const errText = (c: string) => (t.errors as Record<string, string>)[c] ?? t.errors.generic;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shop/public/${handle}/account`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setSent(true);
      else setError(body.error ?? 'generic');
    } catch {
      setError('network');
    }
    setBusy(false);
  };
  if (token && !expired) {
    return (
      <section className="sf-section sf-narrow">
        <h1 className="sf-h1">{t.accountTitle}</h1>
        {!data ? (
          <p className="sf-muted" role="status">{t.loading}</p>
        ) : data.orders.length === 0 ? (
          <p className="sf-muted">{t.accountEmpty}</p>
        ) : (
          <ul className="sf-orders" data-testid="sf-account-orders">
            {data.orders.map((o) => (
              <li key={o.statusToken}>
                <Link href={`/store/${handle}/orders/${o.statusToken}`}>#{o.number}</Link>
                <span className="sf-muted">{(t.status as Record<string, string>)[o.status] ?? o.status}</span>
                <span className="sf-muted">{mounted ? new Date(`${o.createdAt.replace(' ', 'T')}Z`).toLocaleDateString(locale) : ''}</span>
                <strong>{formatMoney(o.totalCents, o.currency, locale)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return (
    <section className="sf-section sf-narrow">
      <h1 className="sf-h1">{t.accountTitle}</h1>
      {expired && <p className="sf-warn" role="alert">{t.accountExpired}</p>}
      {sent ? (
        <p role="status" data-testid="sf-account-sent">{t.accountSent}</p>
      ) : (
        <form onSubmit={submit} className="sf-panel">
          <p className="sf-muted">{t.accountHelp}</p>
          <label className="sf-field">
            <span>{t.email}</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} name="email" />
          </label>
          {error && <p className="sf-error" role="alert">{errText(error)}</p>}
          <button type="submit" className="sf-btn sf-btn-primary" disabled={busy}>{t.accountSend}</button>
        </form>
      )}
    </section>
  );
}
