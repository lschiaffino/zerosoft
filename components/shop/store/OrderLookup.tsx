'use client';

import { useState, type FormEvent } from 'react';
import type { StorefrontStrings } from '@/lib/shop-i18n';

/** Estado del pedido sin cuenta: número + email (los dos tienen que coincidir). */
export default function OrderLookup({ handle, t }: { handle: string; t: StorefrontStrings }) {
  const [number, setNumber] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shop/public/${handle}/order`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ number, email }),
      });
      const data = (await res.json().catch(() => ({}))) as { statusToken?: string; error?: string };
      if (res.ok && data.statusToken) {
        window.location.assign(`/store/${handle}/orders/${data.statusToken}`);
        return;
      }
      setError(res.status === 429 ? t.errors.rate_limited : t.orderNotFound);
    } catch {
      setError(t.errors.generic);
    }
    setBusy(false);
  };
  return (
    <section className="sf-section sf-narrow">
      <h1 className="sf-h1">{t.orderStatus}</h1>
      <p className="sf-muted">{t.orderLookupHelp}</p>
      <form className="sf-form" onSubmit={submit}>
        <label className="sf-field">
          <span>{t.orderNumber}</span>
          <input required inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="1001" />
        </label>
        <label className="sf-field">
          <span>{t.email}</span>
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && (
          <p className="sf-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="sf-btn sf-btn-primary" disabled={busy}>
          {t.findOrder}
        </button>
      </form>
    </section>
  );
}
