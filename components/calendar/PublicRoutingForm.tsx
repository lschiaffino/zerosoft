'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { BookingInfo } from './PublicBookingPage';

interface PublicField {
  name: string;
  label: string;
  type: 'text' | 'select' | 'boolean';
  options: string[];
  required: boolean;
}

interface PublicRoutingFormProps {
  locale: string;
  hostName?: string;
  form: {
    id: string;
    slug: string;
    title: string;
    description: string;
    fields: PublicField[];
  };
}

/**
 * Formulario público de routing: hace las preguntas, evalúa las reglas vía
 * POST /api/calendar/routing/<form id>/route y redirige al booking page del
 * event type destino. Las respuestas de campos llamados `name`/`email` se
 * llevan como query params (?name=&email=) para pre-llenar el booking.
 */
export default function PublicRoutingForm({ form, hostName }: PublicRoutingFormProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateAnswer(name: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [name]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/routing/${form.id}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
    }).catch(() => null);

    if (res && res.status === 200) {
      const data = (await res.json()) as { eventTypeSlug: string; bookPath: string };
      const qs = new URLSearchParams();
      const name = answers.name;
      const email = answers.email;
      if (typeof name === 'string' && name.trim()) qs.set('name', name.trim());
      if (typeof email === 'string' && email.trim()) qs.set('email', email.trim());
      const suffix = qs.toString();
      router.push(`${data.bookPath}${suffix ? `?${suffix}` : ''}`);
      return;
    }
    setBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    setError(data?.error === 'no_route' ? t('routing.noRoute') : t('errors.generic'));
  }

  return (
    <div className="bk">
      <div className="bk-card">
        <BookingInfo hostName={hostName} title={form.title} description={form.description} />
        <div className="bk-main">
          <form className="bk-form" onSubmit={submit}>
            <h2 className="bk-h2">{t('routing.publicLead')}</h2>
            {form.fields.length === 0 && <p className="bk-note">{t('routing.publicEmpty')}</p>}
            {form.fields.map((field) =>
              field.type === 'boolean' ? (
                <label key={field.name} className="ui-check">
                  <input
                    type="checkbox"
                    checked={answers[field.name] === true}
                    onChange={(e) => updateAnswer(field.name, e.target.checked)}
                    required={field.required}
                  />
                  <span>{field.label}</span>
                </label>
              ) : (
                <div key={field.name} className="ui-field">
                  <label className="label" htmlFor={`rf-${field.name}`}>
                    {field.label} {!field.required && <span className="ui-optional">{t('editor.optional')}</span>}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      id={`rf-${field.name}`}
                      className="select"
                      value={String(answers[field.name] ?? '')}
                      onChange={(e) => updateAnswer(field.name, e.target.value)}
                      required={field.required}
                    >
                      <option value="" disabled>
                        {t('routing.choose')}
                      </option>
                      {field.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`rf-${field.name}`}
                      className="input"
                      type={field.name === 'email' ? 'email' : 'text'}
                      autoComplete={field.name === 'email' ? 'email' : field.name === 'name' ? 'name' : undefined}
                      value={String(answers[field.name] ?? '')}
                      onChange={(e) => updateAnswer(field.name, e.target.value)}
                      required={field.required}
                    />
                  )}
                </div>
              ),
            )}
            {error && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
            <div className="bk-actions bk-actions-end">
              <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
                {t('routing.submit')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
