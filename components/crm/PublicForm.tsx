'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicFormDto } from '@/lib/crm-forms';
import type { FieldError } from '@/lib/crm-forms-schema';

interface Props {
  form: PublicFormDto;
  embed: boolean;
  /** UTM / parámetros de URL de la página (o de la página contenedora en embed). */
  urlParams: Record<string, string>;
  pageUrl: string;
  referrer: string;
}

/**
 * Formulario público: campos según la definición, honeypot oculto, tiempo
 * desde que se mostró (anti-spam) y UTM. En embed avisa su alto al iframe
 * padre (zs-form:height) y el envío (zs-form:submitted).
 */
export default function PublicForm({ form, embed, urlParams, pageUrl, referrer }: Props) {
  const t = useTranslations('crm.formsPublic');
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const f of form.fields) init[f.id] = f.type === 'checkbox' ? false : f.type === 'hidden' ? '' : (f.defaultValue ?? '');
    return init;
  });
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, FieldError>>({});
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const shownAt = useRef<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  // Alto automático en embed: el alto del contenido (no el del viewport del
  // iframe, que nunca dejaría achicarlo después de enviar).
  useEffect(() => {
    if (!embed || typeof window === 'undefined' || window.parent === window) return;
    const post = () => {
      let bottom = 0;
      for (const el of Array.from(document.body.children)) {
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom + window.scrollY);
      }
      window.parent.postMessage({ type: 'zs-form:height', height: Math.ceil(bottom) + 8 }, '*');
    };
    post();
    const ro = new ResizeObserver(post);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [embed, status]);

  const s = form.settings;
  const paused = form.status !== 'active';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'busy') return;
    setStatus('busy');
    setErrors({});
    const page = pageUrl || (embed ? '' : window.location.href);
    const res = await fetch(`/api/crm/forms/submit/${encodeURIComponent(form.key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        values,
        consent,
        website_url: honeypot,
        elapsedMs: Date.now() - shownAt.current,
        utm: urlParams,
        pageUrl: page.slice(0, 2000),
        referrer: (referrer || (embed ? '' : document.referrer)).slice(0, 2000),
      }),
    }).catch(() => null);
    const data = res
      ? ((await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          fieldErrors?: Record<string, FieldError>;
          successMode?: 'message' | 'redirect';
          successMessage?: string;
          redirectUrl?: string;
        } | null)
      : null;
    if (res?.ok && data?.ok) {
      if (embed && window.parent !== window) {
        window.parent.postMessage(
          { type: 'zs-form:submitted', form: form.key, redirectUrl: data.successMode === 'redirect' ? data.redirectUrl : '' },
          '*',
        );
      }
      if (data.successMode === 'redirect' && data.redirectUrl) {
        if (!embed) {
          window.location.href = data.redirectUrl;
          return;
        }
      }
      setMessage(data.successMessage || t('thanks'));
      setStatus('done');
      return;
    }
    if (data?.fieldErrors) setErrors(data.fieldErrors);
    setMessage(
      res?.status === 429 ? t('rateLimited') : data?.error === 'paused' ? t('paused') : data?.fieldErrors ? t('fixErrors') : t('error'),
    );
    setStatus('error');
  }

  function set(id: string, v: string | boolean) {
    setValues((prev) => ({ ...prev, [id]: v }));
    if (errors[id]) setErrors((prev) => ({ ...prev, [id]: undefined as unknown as FieldError }));
  }

  if (status === 'done') {
    return (
      <div className="fp-card" ref={rootRef}>
        <p className="fp-done" role="status" data-testid="form-success">
          {message}
        </p>
      </div>
    );
  }

  return (
    <div className="fp-card" ref={rootRef}>
      {(s.title || s.description) && (
        <header className="fp-head">
          {s.title && <h1 className="fp-title">{s.title}</h1>}
          {s.description && <p className="fp-desc">{s.description}</p>}
        </header>
      )}
      {paused ? (
        <p className="fp-paused">{t('paused')}</p>
      ) : (
        <form className="fp-form" onSubmit={onSubmit} noValidate>
          {form.fields
            .filter((f) => f.type !== 'hidden')
            .map((f) => {
              const err = errors[f.id];
              const id = `fp-${f.id}`;
              if (f.type === 'checkbox') {
                return (
                  <div key={f.id} className="fp-field fp-check">
                    <label htmlFor={id}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={values[f.id] === true}
                        onChange={(e) => set(f.id, e.target.checked)}
                        aria-invalid={!!err}
                      />
                      <span>
                        {f.label}
                        {f.required && <span className="fp-req"> *</span>}
                      </span>
                    </label>
                    {err && <p className="fp-err">{t(`errors.${err}`)}</p>}
                  </div>
                );
              }
              const common = {
                id,
                name: f.id,
                value: String(values[f.id] ?? ''),
                placeholder: f.placeholder ?? '',
                required: f.required,
                'aria-invalid': !!err,
              };
              return (
                <div key={f.id} className="fp-field">
                  <label htmlFor={id}>
                    {f.label}
                    {f.required && <span className="fp-req"> *</span>}
                  </label>
                  {f.type === 'textarea' ? (
                    <textarea {...common} rows={4} maxLength={5000} onChange={(e) => set(f.id, e.target.value)} />
                  ) : f.type === 'select' ? (
                    <select {...common} onChange={(e) => set(f.id, e.target.value)}>
                      <option value="">{f.placeholder || t('choose')}</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      {...common}
                      type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                      autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : undefined}
                      maxLength={500}
                      onChange={(e) => set(f.id, e.target.value)}
                    />
                  )}
                  {err && <p className="fp-err">{t(`errors.${err}`)}</p>}
                </div>
              );
            })}
          {/* Honeypot: invisible para personas (y fuera del orden de tab); los bots lo completan. */}
          <div className="fp-hp" aria-hidden="true">
            <label htmlFor="fp-website-url">Website</label>
            <input
              id="fp-website-url"
              name="website_url"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>
          {s.consentText && (
            <div className="fp-field fp-check">
              <label htmlFor="fp-consent">
                <input
                  id="fp-consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-invalid={!!errors.__consent}
                />
                <span>
                  {s.consentText}
                  {s.consentRequired && <span className="fp-req"> *</span>}
                </span>
              </label>
              {errors.__consent && <p className="fp-err">{t('errors.required')}</p>}
            </div>
          )}
          {status === 'error' && message && (
            <p className="fp-err fp-err-main" role="alert">
              {message}
            </p>
          )}
          <button type="submit" className="fp-submit" disabled={status === 'busy'}>
            {status === 'busy' ? t('sending') : s.submitText || t('submit')}
          </button>
        </form>
      )}
    </div>
  );
}
