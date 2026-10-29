'use client';

import { useId, useState, type FormEvent } from 'react';
import type { AgentReplyUi } from '@/lib/agents-config';

/**
 * Botones de respuesta rápida o formulario que acompaña una respuesta del
 * agente (playground y página pública). Tocar un botón manda ese texto;
 * enviar el formulario manda los valores (el servidor los valida).
 */
export default function AgentReplyBlock({
  ui,
  labels,
  onChoose,
  onSubmit,
}: {
  ui: AgentReplyUi;
  labels: { send: string; required: string; choose: string };
  onChoose: (option: string) => void;
  onSubmit: (formId: string, values: Record<string, string>, text: string) => void;
}) {
  const uid = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  if (ui.kind === 'buttons') {
    return (
      <div className="ag-reply-buttons" role="group">
        {ui.options.map((o) => (
          <button key={o} type="button" className="btn btn-secondary btn-sm" onClick={() => onChoose(o)}>
            {o}
          </button>
        ))}
      </div>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ui.kind !== 'form') return;
    const clean: Record<string, string> = {};
    for (const f of ui.fields) {
      const v = (values[f.key] ?? '').trim();
      if (f.required && !v) {
        setError(true);
        return;
      }
      if (v) clean[f.key] = v;
    }
    if (Object.keys(clean).length === 0) {
      setError(true);
      return;
    }
    setError(false);
    const text = ui.fields
      .filter((f) => clean[f.key] !== undefined)
      .map((f) => `${f.label}: ${clean[f.key]}`)
      .join('\n');
    onSubmit(ui.formId, clean, text);
  }

  return (
    <form className="ag-reply-form" onSubmit={submit} aria-label={ui.title || undefined} noValidate>
      {ui.title && <p className="ag-reply-form-title">{ui.title}</p>}
      {ui.fields.map((f) => {
        const id = `${uid}-${f.key}`;
        const common = {
          id,
          value: values[f.key] ?? '',
          required: f.required,
          'aria-invalid': error && f.required && !(values[f.key] ?? '').trim() ? true : undefined,
        };
        const onChange = (v: string) => setValues((prev) => ({ ...prev, [f.key]: v }));
        return (
          <div key={f.key} className="ui-field">
            <label className="label" htmlFor={id}>
              {f.label}
              {f.required ? ' *' : ''}
            </label>
            {f.type === 'select' ? (
              <select className="select" {...common} onChange={(e) => onChange(e.target.value)}>
                <option value="">{labels.choose}</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea className="textarea" rows={3} maxLength={2000} {...common} onChange={(e) => onChange(e.target.value)} />
            ) : (
              <input
                className="input"
                maxLength={300}
                type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : 'text'}
                autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : undefined}
                {...common}
                onChange={(e) => onChange(e.target.value)}
              />
            )}
          </div>
        );
      })}
      {error && (
        <p className="ui-error" role="alert">
          {labels.required}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-sm">
        {ui.submitLabel || labels.send}
      </button>
    </form>
  );
}
