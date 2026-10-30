'use client';

import { useState, type FormEvent } from 'react';
import type { Question } from '@/lib/hiring/types';
import type { CareersStrings } from '@/lib/hiring/careers-i18n';

/** Formulario de postulación: datos, CV, preguntas del puesto, consentimiento y un campo trampa para bots. */
export default function ApplyForm({
  handle,
  job,
  questions,
  consentText,
  utm,
  source,
  t,
}: {
  handle: string;
  job: string;
  questions: Question[];
  consentText: string;
  utm: Record<string, string>;
  source: string | null;
  t: CareersStrings;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set('handle', handle);
    form.set('job', job);
    for (const [k, v] of Object.entries(utm)) form.set(k, v);
    if (source) form.set('source', source);
    form.set('referrer', document.referrer.slice(0, 500));
    try {
      const res = await fetch('/api/hiring/public/apply', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(t.errors[data.error ?? 'generic'] ?? t.errors.generic);
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError(t.errors.generic);
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="cr-done" role="status">
        <h3 className="cr-h3">{t.thanksTitle}</h3>
        <p>{t.thanksBody}</p>
      </div>
    );
  }

  return (
    <form className="cr-form" onSubmit={submit} encType="multipart/form-data" noValidate={false}>
      <label className="cr-field">
        <span className="cr-label">{t.name}</span>
        <input className="cr-input" name="name" required maxLength={160} autoComplete="name" />
      </label>
      <label className="cr-field">
        <span className="cr-label">{t.email}</span>
        <input className="cr-input" name="email" type="email" required maxLength={254} autoComplete="email" />
      </label>
      <label className="cr-field">
        <span className="cr-label">
          {t.phone} <span className="cr-optional">({t.optional})</span>
        </span>
        <input className="cr-input" name="phone" type="tel" maxLength={40} autoComplete="tel" />
      </label>
      <label className="cr-field">
        <span className="cr-label">
          {t.linkedin} <span className="cr-optional">({t.optional})</span>
        </span>
        <input className="cr-input" name="linkedin" type="url" maxLength={300} placeholder="https://" />
      </label>
      <label className="cr-field">
        <span className="cr-label">{t.resume}</span>
        <input className="cr-input" name="resume" type="file" required accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
        <span className="cr-help">{t.resumeHelp}</span>
      </label>
      {questions.map((q) => {
        const name = `answers[${q.id}]`;
        const label = (
          <span className="cr-label">
            {q.label} {!q.required && <span className="cr-optional">({t.optional})</span>}
          </span>
        );
        if (q.type === 'yesno') {
          return (
            <fieldset key={q.id} className="cr-field cr-fieldset">
              <legend className="cr-label">{q.label}</legend>
              <div className="cr-radios">
                <label className="cr-radio">
                  <input type="radio" name={name} value="yes" required={q.required} /> {t.yes}
                </label>
                <label className="cr-radio">
                  <input type="radio" name={name} value="no" required={q.required} /> {t.no}
                </label>
              </div>
            </fieldset>
          );
        }
        if (q.type === 'select') {
          return (
            <label key={q.id} className="cr-field">
              {label}
              <select className="cr-input" name={name} required={q.required} defaultValue="">
                <option value="" disabled>
                  {t.choose}
                </option>
                {q.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={q.id} className="cr-field">
            {label}
            {q.type === 'textarea' ? (
              <textarea className="cr-input" name={name} rows={4} maxLength={5000} required={q.required} />
            ) : (
              <input className="cr-input" name={name} type={q.type === 'number' ? 'number' : 'text'} step="any" maxLength={500} required={q.required} />
            )}
          </label>
        );
      })}
      {/* Trampa para bots: oculta para personas y lectores de pantalla. */}
      <div className="cr-trap" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="cr-check">
        <input type="checkbox" name="consent" required />
        <span>{consentText}</span>
      </label>
      <label className="cr-check">
        <input type="checkbox" name="keepConsent" />
        <span>{t.keepConsent}</span>
      </label>
      {error && (
        <p className="cr-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="cr-button" disabled={busy}>
        {busy ? t.sending : t.submit}
      </button>
    </form>
  );
}
