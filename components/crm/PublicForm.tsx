'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicFormDto } from '@/lib/crm-forms';
import { Captcha } from '@/components/ui/TurnstileCaptcha';
import { formSteps, isFieldVisible, type FieldError, type FormField } from '@/lib/crm-forms-schema';


interface Props {
  form: PublicFormDto;
  embed: boolean;
  /** Abierto como popup del embed: Esc le pide a la página que lo cierre. */
  popup?: boolean;
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
export default function PublicForm({ form, embed, popup = false, urlParams, pageUrl, referrer }: Props) {
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
  const [captchaToken, setCaptchaToken] = useState('');
  const steps = formSteps(form.fields);
  const [stepIdx, setStepIdx] = useState(0);
  const lastStep = stepIdx >= steps.length - 1;
  const visible = (f: FormField) => f.type !== 'hidden' && f.type !== 'step' && isFieldVisible(f, values, form.fields);

  /** Valida los campos visibles de un paso antes de avanzar (los mismos chequeos básicos que el servidor). */
  function stepErrors(idx: number): Record<string, FieldError> {
    const out: Record<string, FieldError> = {};
    for (const f of steps[idx]?.fields ?? []) {
      if (!visible(f)) continue;
      const v = values[f.id];
      if (f.type === 'checkbox') {
        if (f.required && v !== true) out[f.id] = 'required';
        continue;
      }
      const text = typeof v === 'string' ? v.trim() : '';
      if (!text) {
        if (f.required) out[f.id] = 'required';
        continue;
      }
      if (f.type === 'email' && !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(text)) out[f.id] = 'invalid_email';
    }
    return out;
  }

  function next() {
    const errs = stepErrors(stepIdx);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setMessage(t('fixErrors'));
      setStatus('error');
      return;
    }
    setStatus('idle');
    setMessage('');
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  }

  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  // Popup del embed (motor común, lib/form-engine-embed.ts): Esc con el foco dentro del iframe también cierra.
  useEffect(() => {
    if (!popup || window.parent === window) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.parent.postMessage({ type: 'zs-form:close', form: form.key }, '*');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popup, form.key]);

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
    if (!lastStep) {
      next();
      return;
    }
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
        ...(form.captchaSiteKey ? { captchaToken } : {}),
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
    if (data?.fieldErrors) {
      setErrors(data.fieldErrors);
      // Vuelve al primer paso con un error.
      const firstBad = steps.findIndex((st) => st.fields.some((f) => data.fieldErrors?.[f.id]));
      if (firstBad >= 0) setStepIdx(firstBad);
    }
    setMessage(
      res?.status === 429
        ? t('rateLimited')
        : data?.error === 'paused'
          ? t('paused')
          : data?.error === 'captcha'
            ? t('captchaFailed')
            : data?.fieldErrors
              ? t('fixErrors')
              : t('error'),
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
          {steps.length > 1 && (
            <div className="fp-steps" data-testid="form-steps">
              <p className="fp-step-count">{t('stepOf', { current: stepIdx + 1, total: steps.length })}</p>
              {steps[stepIdx]?.title && <h2 className="fp-step-title">{steps[stepIdx].title}</h2>}
              <div className="fp-step-bar" aria-hidden="true">
                <span style={{ width: `${((stepIdx + 1) / steps.length) * 100}%` }} />
              </div>
            </div>
          )}
          {(steps[stepIdx]?.fields ?? [])
            .filter(visible)
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
          {lastStep && s.consentText && (
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
          {lastStep && form.captchaSiteKey && <Captcha siteKey={form.captchaSiteKey} label={t('captchaTest')} onToken={setCaptchaToken} />}
          {status === 'error' && message && (
            <p className="fp-err fp-err-main" role="alert">
              {message}
            </p>
          )}
          <div className="fp-actions">
            {stepIdx > 0 && (
              <button
                type="button"
                className="fp-back"
                onClick={() => {
                  setStatus('idle');
                  setMessage('');
                  setStepIdx((i) => Math.max(0, i - 1));
                }}
              >
                {t('back')}
              </button>
            )}
            <button type="submit" className="fp-submit" disabled={status === 'busy' || (lastStep && !!form.captchaSiteKey && !captchaToken)}>
              {!lastStep ? t('next') : status === 'busy' ? t('sending') : s.submitText || t('submit')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
