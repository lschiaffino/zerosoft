'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { FormFieldDef } from '@/lib/flow-schema';

interface Props {
  token: string;
  fields: FormFieldDef[];
  submitLabel: string;
  successMessage: string;
}

/** Formulario público de un flow: valida en el server y muestra el error de cada campo. */
export default function HostedForm({ token, fields, submitLabel, successMessage }: Props) {
  const t = useTranslations('flow.formPage');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const hp = (new FormData(e.currentTarget).get('_hp') as string | null) ?? '';
    const res = await fetch(`/api/flow/hooks/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...values, _hp: hp }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setSent(true);
      return;
    }
    const data = (await res?.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
    if (data?.error === 'invalid_form' && data.fields) {
      setErrors(data.fields);
      const first = Object.keys(data.fields)[0];
      if (first) document.getElementById(`ff-${first}`)?.focus();
      return;
    }
    setError(data?.error === 'rate_limited' ? t('errors.rate_limited') : data?.error === 'not_found' ? t('closed') : t('errors.generic'));
  }

  if (sent) {
    return (
      <div className="fa-state" role="status">
        <p className="fa-state-title is-approved">{successMessage || t('sent')}</p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setValues({});
            setSent(false);
          }}
        >
          {t('again')}
        </button>
      </div>
    );
  }

  return (
    <form className="fa-form" onSubmit={(e) => void submit(e)} noValidate>
      {fields.map((f) => {
        const id = `ff-${f.key}`;
        const err = errors[f.key];
        const common = {
          id,
          name: f.key,
          'aria-invalid': err ? true : undefined,
          'aria-describedby': err ? `${id}-err` : undefined,
          required: f.required,
        } as const;
        const value = values[f.key];
        const set = (v: string | boolean) => setValues((s) => ({ ...s, [f.key]: v }));
        return (
          <div className="ui-field" key={f.key}>
            {f.type === 'checkbox' ? (
              <label className="ui-check">
                <input {...common} type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} />
                <span>
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
              </label>
            ) : (
              <>
                <label className="label" htmlFor={id}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </label>
                {f.type === 'textarea' ? (
                  <textarea {...common} className="textarea" rows={4} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
                ) : f.type === 'select' ? (
                  <select {...common} className="select" value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
                    <option value="">{t('choose')}</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    className="input"
                    type={f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={String(value ?? '')}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </>
            )}
            {err && (
              <p className="ui-error" id={`${id}-err`}>
                {t(`fieldErrors.${err}`)}
              </p>
            )}
          </div>
        );
      })}
      {/* Campo trampa para bots: fuera de la vista y del teclado. */}
      <input type="text" name="_hp" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" defaultValue="" />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="fa-actions">
        <button type="submit" className="btn btn-primary" aria-busy={busy || undefined} disabled={busy}>
          {submitLabel || t('submit')}
        </button>
      </div>
    </form>
  );
}
