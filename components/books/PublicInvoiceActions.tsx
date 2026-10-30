'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/** Acciones de la factura pública: pagar (Stripe / Mercado Pago), descargar el PDF e imprimir. */
export default function PublicInvoiceActions({ token, methods, amount, justPaid, paid }: { token: string; methods: Array<'stripe' | 'mercadopago'>; amount: string | null; justPaid: boolean; paid: boolean }) {
  const t = useTranslations('books.public');
  const te = useTranslations('books.errors');
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pay = async (method: 'stripe' | 'mercadopago') => {
    setBusy(method);
    setError(null);
    try {
      const res = await fetch(`/api/books/public/${encodeURIComponent(token)}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, locale }) });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'generic');
      window.location.assign(data.url);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'generic';
      setError(te.has(code) ? te(code) : te('generic'));
      setBusy(null);
    }
  };
  return (
    <aside className="bk-public-actions" aria-label={t('actions')}>
      {justPaid && !paid && <p className="bk-public-muted" role="status">{t('processing')}</p>}
      {paid && <p className="bk-public-ok" role="status">{t('thanks')}</p>}
      {amount && methods.length > 0 && (
        <div className="bk-public-pay">
          <p className="bk-public-label">{t('payAmount', { amount })}</p>
          {methods.map((m) => (
            <button key={m} type="button" className="bk-public-btn bk-public-btn-primary" disabled={!!busy} aria-busy={busy === m} onClick={() => pay(m)}>
              {m === 'stripe' ? t('payCard') : t('payMp')}
            </button>
          ))}
        </div>
      )}
      {amount && methods.length === 0 && <p className="bk-public-muted">{t('payOffline')}</p>}
      {error && (
        <p className="bk-public-error" role="alert">
          {error}
        </p>
      )}
      <div className="bk-public-row">
        <a className="bk-public-btn" href={`/api/books/public/${encodeURIComponent(token)}/pdf?locale=${locale}`} target="_blank" rel="noreferrer">
          {t('downloadPdf')}
        </a>
        <button type="button" className="bk-public-btn" onClick={() => window.print()}>
          {t('print')}
        </button>
      </div>
    </aside>
  );
}
