'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FEEDBACK_KINDS, FEEDBACK_MAX, FEEDBACK_PRODUCTS, type FeedbackKind, type FeedbackProduct } from '@/lib/feedback-constants';
import '@/styles/feedback.css';

/** Color de cada producto (tokens --c-* de globals.css). */
const PRODUCT_COLOR: Partial<Record<FeedbackProduct, string>> = {
  link: 'var(--c-link)',
  crm: 'var(--c-crm)',
  cal: 'var(--c-cal)',
  track: 'var(--c-track)',
  chat: 'var(--c-chat)',
  docs: 'var(--c-docs)',
  flow: 'var(--c-flow)',
  notes: 'var(--c-notes)',
  board: 'var(--c-board)',
};

/**
 * Formulario de feedback compartido: modal de la app (con sesión, sin email)
 * y página pública /feedback (email opcional). Postea a /api/feedback.
 */
export default function FeedbackForm({
  defaultProduct = 'site',
  signedInEmail = null,
  onDone,
  onCancel,
}: {
  defaultProduct?: FeedbackProduct;
  signedInEmail?: string | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('feedback.form');
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [product, setProduct] = useState<FeedbackProduct>(defaultProduct);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    setError(null);
    if (message.trim().length < 3) {
      setError(t('errorInvalid'));
      return;
    }
    setState('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          product,
          message,
          email: signedInEmail ? undefined : email || undefined,
          pageUrl: window.location.href,
          website,
        }),
      });
      if (res.ok) {
        setState('sent');
        return;
      }
      setError(res.status === 429 ? t('errorRate') : res.status === 400 ? t('errorInvalid') : t('errorGeneric'));
    } catch {
      setError(t('errorGeneric'));
    }
    setState('idle');
  }

  function reset() {
    setMessage('');
    setKind('idea');
    setState('idle');
  }

  if (state === 'sent') {
    return (
      <div className="fb-success" role="status">
        <span className="fb-success-mark" aria-hidden="true">0</span>
        <p className="fb-success-title">{t('successTitle')}</p>
        <p className="fb-success-body">{t('successBody')}</p>
        <div className="fb-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={reset}>
            {t('another')}
          </button>
          {onDone && (
            <button type="button" className="btn btn-solid btn-small" onClick={onDone}>
              {t('close')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="fb-form" onSubmit={submit} noValidate>
      <div className="fb-field">
        <span className="label" id="fb-kind-label">{t('kindLabel')}</span>
        <div className="fb-kinds" role="radiogroup" aria-labelledby="fb-kind-label">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={`fb-kind${kind === k ? ' active' : ''}`}
              onClick={() => setKind(k)}
            >
              <span className={`fb-kind-glyph fb-kind-${k}`} aria-hidden="true" />
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="fb-field">
        <span className="label">{t('productLabel')}</span>
        <span className="fb-select-wrap" style={{ '--dot': PRODUCT_COLOR[product] ?? 'var(--line)' } as CSSProperties}>
          <select className="select" value={product} onChange={(e) => setProduct(e.target.value as FeedbackProduct)}>
            {FEEDBACK_PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {t(`product.${p}`)}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="fb-field">
        <span className="label">{t('messageLabel')}</span>
        <textarea
          className="textarea fb-textarea"
          value={message}
          maxLength={FEEDBACK_MAX}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t(`placeholder.${kind}`)}
          rows={5}
          required
          autoFocus
        />
        <span className="fb-count mono">{t('count', { count: message.length, max: FEEDBACK_MAX })}</span>
      </label>

      {signedInEmail ? (
        <p className="fb-hint mono">{t('signedInAs', { email: signedInEmail })}</p>
      ) : (
        <label className="fb-field">
          <span className="label">{t('emailLabel')}</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            autoComplete="email"
          />
          <span className="fb-hint mono">{t('emailHint')}</span>
        </label>
      )}

      {/* Honeypot: invisible para personas, los bots lo completan. */}
      <div className="fb-hp" aria-hidden="true">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>

      {error && (
        <p className="fb-error" role="alert">
          {error}
        </p>
      )}

      <div className="fb-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
            {t('cancel')}
          </button>
        )}
        <button type="submit" className="btn btn-solid btn-small" disabled={state === 'sending'}>
          {state === 'sending' ? t('sending') : t('send')}
        </button>
      </div>
    </form>
  );
}
