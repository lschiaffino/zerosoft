'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface QuotePublicActionsProps {
  token: string;
  status: 'sent' | 'accepted' | 'declined' | 'expired' | 'draft';
}

const KNOWN = new Set(['expired', 'not_open', 'invalid_signature', 'not_found', 'rate_limited']);

/**
 * Aceptar (nombre tipeado + checkbox) o rechazar (motivo opcional) un quote
 * desde la página pública. Al responder se refresca el documento con el estado.
 */
export default function QuotePublicActions({ token, status }: QuotePublicActionsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [mode, setMode] = useState<'accept' | 'decline'>('accept');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/quotes/public/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? '';
    setError(KNOWN.has(code) ? t(`quotePublic.errors.${code}`) : t('errors.generic'));
    if (code === 'expired' || code === 'not_open') router.refresh();
  }

  const printButton = (
    <button type="button" className="qp-btn" onClick={() => window.print()}>
      {t('quotes.print')}
    </button>
  );

  if (status !== 'sent') {
    const message =
      status === 'accepted'
        ? t('quotePublic.stateAccepted')
        : status === 'declined'
          ? t('quotePublic.stateDeclined')
          : t('quotePublic.stateExpired');
    return (
      <div className="qp-actions qp-no-print">
        <p className={`qp-state q-${status}`}>{message}</p>
        {printButton}
      </div>
    );
  }

  return (
    <div className="qp-actions qp-no-print">
      {mode === 'accept' ? (
        <form
          className="qp-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && agree) void send({ action: 'accept', name: name.trim(), agree: true });
          }}
        >
          <p className="qp-heading">{t('quotePublic.acceptTitle')}</p>
          <label className="qp-field">
            <span className="mono">{t('quotePublic.fullName')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={200}
              placeholder={t('quotePublic.fullNamePlaceholder')}
              required
            />
          </label>
          <label className="qp-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{t('quotePublic.agree')}</span>
          </label>
          {error && (
            <p className="qp-error" role="alert">
              {error}
            </p>
          )}
          <div className="qp-row">
            <button type="submit" className="qp-btn qp-primary" disabled={busy || !name.trim() || !agree}>
              {busy ? t('quotePublic.sending') : t('quotePublic.accept')}
            </button>
            <button type="button" className="qp-link" onClick={() => setMode('decline')}>
              {t('quotePublic.decline')}
            </button>
            <span className="qp-spacer" />
            {printButton}
          </div>
          <p className="qp-legal">{t('quotePublic.legal')}</p>
        </form>
      ) : (
        <form
          className="qp-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ action: 'decline', reason: reason.trim() || undefined });
          }}
        >
          <p className="qp-heading">{t('quotePublic.declineTitle')}</p>
          <label className="qp-field">
            <span className="mono">{t('quotePublic.reason')}</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </label>
          {error && (
            <p className="qp-error" role="alert">
              {error}
            </p>
          )}
          <div className="qp-row">
            <button type="submit" className="qp-btn" disabled={busy}>
              {busy ? t('quotePublic.sending') : t('quotePublic.confirmDecline')}
            </button>
            <button type="button" className="qp-link" onClick={() => setMode('accept')}>
              {t('common.back')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
