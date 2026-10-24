'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import SignaturePad from '@/components/crm/SignaturePad';

interface QuotePublicActionsProps {
  token: string;
  status: 'sent' | 'accepted' | 'declined' | 'expired' | 'draft';
  recipientEmail?: string;
  payment?: {
    collect: boolean;
    status: 'none' | 'pending' | 'paid';
    paidAt: string | null;
    canPay: boolean;
    total: number;
    currency: string;
  };
  locale?: string;
}

const KNOWN = new Set(['expired', 'not_open', 'invalid_signature', 'not_found', 'rate_limited', 'payment_unavailable', 'already_paid']);

/** Firma tipeada → imagen JPEG (para quien no puede dibujar con mouse o dedo). */
function typedSignature(name: string): string {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 160;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111111';
  ctx.font = 'italic 56px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 40), 24, 84, 552);
  return c.toDataURL('image/jpeg', 0.85);
}

/**
 * Firmar (nombre tipeado + firma dibujada o tipeada + email + aceptar
 * las condiciones) o rechazar un quote desde la página pública. Ya firmado: estado,
 * certificado descargable y, si el quote cobra, el pago con Stripe Checkout.
 */
export default function QuotePublicActions({ token, status, recipientEmail = '', payment, locale = 'en' }: QuotePublicActionsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [mode, setMode] = useState<'accept' | 'decline'>('accept');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(recipientEmail);
  const [agree, setAgree] = useState(false);
  const [drawn, setDrawn] = useState('');
  const [typed, setTyped] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSignature = typed ? !!name.trim() : !!drawn;

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

  async function pay() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/quotes/public/${encodeURIComponent(token)}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { url?: string; error?: string } | null) : null;
    if (res?.ok && data?.url) {
      window.location.href = data.url;
      return;
    }
    setBusy(false);
    const code = data?.error ?? '';
    setError(KNOWN.has(code) ? t(`quotePublic.errors.${code}`) : t('errors.generic'));
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
    const money = payment
      ? new Intl.NumberFormat(locale, { style: 'currency', currency: payment.currency || 'USD' }).format(payment.total)
      : '';
    return (
      <div className="qp-actions qp-no-print">
        <p className={`qp-state q-${status}`}>{message}</p>
        {status === 'accepted' && payment?.status === 'paid' && (
          <p className="qp-state q-accepted" data-testid="quote-paid">
            {t('quotePublic.paid', {
              date: payment.paidAt
                ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${payment.paidAt.replace(' ', 'T')}Z`))
                : '',
            })}
          </p>
        )}
        {error && (
          <p className="qp-error" role="alert">
            {error}
          </p>
        )}
        <div className="qp-row">
          {status === 'accepted' && payment?.canPay && (
            <button type="button" className="qp-btn qp-primary" onClick={pay} disabled={busy}>
              {busy ? t('quotePublic.sending') : t('quotePublic.pay', { amount: money })}
            </button>
          )}
          {status === 'accepted' && (
            <a className="qp-btn" href={`/api/crm/quotes/public/${encodeURIComponent(token)}/certificate`} download>
              {t('quotePublic.certificate')}
            </a>
          )}
          {printButton}
        </div>
        {status === 'accepted' && payment?.canPay && <p className="qp-legal">{t('quotePublic.payHint')}</p>}
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
            if (!name.trim() || !agree || !hasSignature) return;
            void send({
              action: 'accept',
              name: name.trim(),
              agree: true,
              email: email.trim(),
              signature: typed ? typedSignature(name.trim()) : drawn,
            });
          }}
        >
          <p className="qp-heading">{t('quotePublic.acceptTitle')}</p>
          <div className="qp-fields-2">
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
            <label className="qp-field">
              <span className="mono">{t('quotePublic.email')}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={320} />
            </label>
          </div>
          <div className="qp-field">
            <span className="mono">{t('quotePublic.signature')}</span>
            {typed ? (
              <p className="qp-typed-sign" aria-live="polite">
                {name.trim() || t('quotePublic.typedEmpty')}
              </p>
            ) : (
              <SignaturePad label={t('quotePublic.drawHint')} clearLabel={t('quotePublic.clear')} onChange={setDrawn} />
            )}
            <button type="button" className="qp-link qp-sign-switch" onClick={() => setTyped((v) => !v)}>
              {typed ? t('quotePublic.drawInstead') : t('quotePublic.typeInstead')}
            </button>
          </div>
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
            <button type="submit" className="qp-btn qp-primary" disabled={busy || !name.trim() || !agree || !hasSignature}>
              {busy ? t('quotePublic.sending') : t('quotePublic.sign')}
            </button>
            <button type="button" className="qp-link" onClick={() => setMode('decline')}>
              {t('quotePublic.decline')}
            </button>
            <span className="qp-spacer" />
            {printButton}
          </div>
          <p className="qp-legal">{t('quotePublic.legalSign')}</p>
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
