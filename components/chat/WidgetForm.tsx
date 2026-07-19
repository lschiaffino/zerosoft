'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ChatWidgetRow } from '@/lib/db';

export interface WidgetFormField {
  id: string;
  name: string;
  required: boolean;
  type: 'text' | 'email' | 'number';
}

interface WidgetFormProps {
  initial?: ChatWidgetRow | null;
}

function emptyField(): WidgetFormField {
  return { id: crypto.randomUUID(), name: '', required: false, type: 'text' };
}

function parseFields(initial: ChatWidgetRow | null | undefined): WidgetFormField[] {
  if (!initial) return [];
  try {
    const list = JSON.parse(initial.fields) as unknown[];
    if (!Array.isArray(list)) return [];
    return list
      .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
      .map((f) => ({
        id: typeof f.id === 'string' ? f.id : crypto.randomUUID(),
        name: typeof f.name === 'string' ? f.name : '',
        required: f.required === true,
        type: ['text', 'email', 'number'].includes(typeof f.type === 'string' ? f.type : '')
          ? (f.type as 'text' | 'email' | 'number')
          : 'text',
      }));
  } catch {
    return [];
  }
}

export default function WidgetForm({ initial }: WidgetFormProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState({
    name: initial?.name ?? '',
    color: initial?.color ?? '#000000',
    position: initial?.position ?? 'bottom-right',
    welcomeMessage: initial?.welcome_message ?? '',
  });
  const [fields, setFields] = useState<WidgetFormField[]>(parseFields(initial));

  function set<K extends keyof typeof values>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((prev) => ({ ...prev, [key]: e.target.value }));
    };
  }

  function updateField(index: number, patch: Partial<WidgetFormField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function addField() {
    setFields((prev) => [...prev, emptyField()]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      name: values.name.trim(),
      color: values.color,
      position: values.position as 'bottom-right' | 'bottom-left',
      welcomeMessage: values.welcomeMessage.trim() || undefined,
      fields: fields
        .filter((f) => f.name.trim())
        .map((f) => ({ id: f.id, name: f.name.trim(), required: f.required, type: f.type })),
    };

    const url = initial ? `/api/chat/widgets/${initial.id}` : '/api/chat/widgets';
    const method = initial ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (res && (res.status === 200 || res.status === 201)) {
      const data = (await res.json()) as { id: string };
      router.push(`/app/chat/widgets/${data.id}`);
      return;
    }

    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t(`errors.${code}` as const) || t('errors.generic'));
    setBusy(false);
  }

  return (
    <form className="chat-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('widgetForm.name')}</span>
          <input className="input" value={values.name} onChange={set('name')} required />
        </label>
        <label className="field">
          <span className="prop-label">{t('widgetForm.color')}</span>
          <input className="input" type="color" value={values.color} onChange={set('color')} />
        </label>
      </div>

      <label className="field">
        <span className="prop-label">{t('widgetForm.position')}</span>
        <select className="select" value={values.position} onChange={set('position')}>
          <option value="bottom-right">{t('widgetForm.positionBottomRight')}</option>
          <option value="bottom-left">{t('widgetForm.positionBottomLeft')}</option>
        </select>
      </label>

      <label className="field">
        <span className="prop-label">{t('widgetForm.welcomeMessage')}</span>
        <textarea
          className="input textarea"
          rows={3}
          value={values.welcomeMessage}
          onChange={set('welcomeMessage')}
        />
      </label>

      <section className="panel fields-panel">
        <div className="panel-head">
          <p className="section-label">{t('widgetForm.fields')}</p>
          <button type="button" className="btn btn-small" onClick={addField}>
            {t('widgetForm.addField')}
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="muted">{t('common.empty')}</p>
        ) : (
          <div className="custom-fields">
            {fields.map((f, i) => (
              <div key={f.id} className="custom-field-row">
                <input
                  className="input"
                  placeholder={t('widgetForm.fieldName')}
                  value={f.name}
                  onChange={(e) => updateField(i, { name: e.target.value })}
                />
                <select
                  className="select"
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as WidgetFormField['type'] })}
                >
                  <option value="text">Text</option>
                  <option value="email">Email</option>
                  <option value="number">Number</option>
                </select>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  <span>{t('widgetForm.fieldRequired')}</span>
                </label>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => removeField(i)}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-solid" disabled={busy}>
          {busy ? t('common.loading') : initial ? t('widgetForm.save') : t('widgetForm.create')}
        </button>
      </div>
    </form>
  );
}
