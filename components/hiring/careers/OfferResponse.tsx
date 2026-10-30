'use client';

import { useState, type FormEvent } from 'react';
import type { PublicOffer } from '@/lib/hiring/offers';
import { fill, type CareersStrings } from '@/lib/hiring/careers-i18n';

/** La oferta como la ve el candidato: la carta, aceptar con el nombre escrito o rechazar. */
export default function OfferResponse({ token, offer, t }: { token: string; offer: PublicOffer; t: CareersStrings }) {
  const [status, setStatus] = useState(offer.status);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (action: 'accept' | 'decline') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/hiring/public/offer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, action, signedName: name, agree, reason }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok) setError(t.errors[data.error ?? 'generic'] ?? t.errors.generic);
      else setStatus((data.status as PublicOffer['status']) ?? status);
    } catch {
      setError(t.errors.generic);
    }
    setBusy(false);
  };

  const accept = (e: FormEvent) => {
    e.preventDefault();
    void send('accept');
  };

  return (
    <div className="cr-wrap">
      <p className="cr-muted">{fill(t.offerFor, { company: offer.company })}</p>
      <h1 className="cr-title">{offer.title}</h1>
      <dl className="cr-offer-facts">
        {offer.salary && (
          <div>
            <dt>{t.offerSalary}</dt>
            <dd>{offer.salary}</dd>
          </div>
        )}
        {offer.startDate && (
          <div>
            <dt>{t.offerStart}</dt>
            <dd>{offer.startDate}</dd>
          </div>
        )}
      </dl>
      <pre className="cr-letter">{offer.body}</pre>
      {status === 'accepted' ? (
        <p className="cr-done" role="status">
          {t.offerAccepted}
        </p>
      ) : status === 'declined' ? (
        <p className="cr-done" role="status">
          {t.offerDeclined}
        </p>
      ) : status !== 'sent' ? (
        <p className="cr-muted">{t.offerClosed}</p>
      ) : declining ? (
        <form
          className="cr-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send('decline');
          }}
        >
          <label className="cr-field">
            <span className="cr-label">{t.offerDeclineReason}</span>
            <textarea className="cr-input" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error && (
            <p className="cr-error" role="alert">
              {error}
            </p>
          )}
          <div className="cr-row">
            <button type="button" className="cr-button cr-button-ghost" onClick={() => setDeclining(false)}>
              {t.offerAccept}
            </button>
            <button type="submit" className="cr-button" disabled={busy}>
              {t.offerDecline}
            </button>
          </div>
        </form>
      ) : (
        <form className="cr-form" onSubmit={accept}>
          <p className="cr-help">{t.offerAcceptHelp}</p>
          <label className="cr-field">
            <span className="cr-label">{t.offerSignName}</span>
            <input className="cr-input" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="cr-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
            <span>{t.offerAgree}</span>
          </label>
          {error && (
            <p className="cr-error" role="alert">
              {error}
            </p>
          )}
          <div className="cr-row">
            <button type="submit" className="cr-button" disabled={busy}>
              {t.offerAccept}
            </button>
            <button type="button" className="cr-button cr-button-ghost" onClick={() => setDeclining(true)}>
              {t.offerDecline}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
