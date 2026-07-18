'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export interface PropField {
  /** Clave del payload PATCH (camelCase, ej. firstName, lifecycleStage).
   *  Con prefijo `custom.<name>` patchea dentro del objeto custom. */
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'date';
  /** Valor actual ('' si está vacío). */
  value: string;
  /** Opciones para type=select. */
  options?: Array<{ value: string; label: string }>;
  /** En select: la opción vacía envía null en vez de ''. */
  nullOption?: boolean;
  /** Custom field boolean: el select 'true'/'false' se guarda como boolean. */
  boolean?: boolean;
}

interface PropertiesPanelProps {
  endpoint: string;
  fields: PropField[];
  /** Objeto custom actual del registro (necesario para mergear campos `custom.*`). */
  custom?: Record<string, unknown>;
}

const ERROR_CODES = ['invalid_email', 'missing_name', 'invalid_input', 'not_found'] as const;

/**
 * dl editable inline: click en el valor (o en ✎) → input/select →
 * PATCH al endpoint y "Saved ✓" transitorio. Genérico: sirve para
 * contacts, companies y deals cambiando endpoint + fields.
 */
export default function PropertiesPanel({ endpoint, fields, custom }: PropertiesPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingKey && inputRef.current) inputRef.current.focus();
  }, [editingKey]);

  useEffect(() => {
    if (!savedKey) return;
    const timer = setTimeout(() => setSavedKey(null), 1600);
    return () => clearTimeout(timer);
  }, [savedKey]);

  function startEdit(field: PropField) {
    setDraft(field.value);
    setEditingKey(field.key);
    setError(null);
  }

  function cancel() {
    setEditingKey(null);
  }

  async function save(field: PropField, raw: string) {
    setEditingKey(null);
    if (raw === field.value) return;
    // Los números no quedan vacíos: si borran el valor, no se guarda nada.
    if (field.type === 'number' && raw === '') return;
    setSavingKey(field.key);
    setError(null);
    let payload: Record<string, unknown>;
    if (field.key.startsWith('custom.')) {
      const name = field.key.slice(7);
      let v: unknown = raw;
      if (field.type === 'number') v = Number(raw);
      else if (field.boolean) v = raw === '' ? null : raw === 'true';
      else if (raw === '' && field.nullOption) v = null;
      payload = { custom: { ...(custom ?? {}), [name]: v } };
    } else if (field.type === 'number') {
      payload = { [field.key]: Number(raw) };
    } else {
      payload = { [field.key]: raw === '' && field.nullOption ? null : raw };
    }
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSavingKey(null);
    if (res && res.ok) {
      setSavedKey(field.key);
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(
      (ERROR_CODES as readonly string[]).includes(code) ? t(`errors.${code}`) : t('errors.generic'),
    );
  }

  return (
    <div>
      <dl className="prop-table">
        {fields.map((field) => {
          const editing = editingKey === field.key;
          // En selects se muestra el label de la opción, no el valor crudo.
          const display =
            field.type === 'select'
              ? (field.options?.find((o) => o.value === field.value)?.label ?? field.value)
              : field.value;
          return (
            <div key={field.key} className="prop-row">
              <dt className="prop-label">{field.label}</dt>
              <dd className="prop-value">
                {editing ? (
                  field.type === 'select' ? (
                    <select
                      className="filter-select"
                      value={draft}
                      onChange={(e) => save(field, e.target.value)}
                      onBlur={cancel}
                      autoFocus
                    >
                      {field.nullOption && <option value="">—</option>}
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      ref={inputRef}
                      className="input"
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') save(field, draft.trim());
                        if (e.key === 'Escape') cancel();
                      }}
                      onBlur={() => save(field, draft.trim())}
                    />
                  )
                ) : (
                  <button
                    type="button"
                    className={`prop-value prop-btn${field.value ? '' : ' empty'}`}
                    onClick={() => startEdit(field)}
                  >
                    {display || '—'}
                  </button>
                )}
                {savedKey === field.key && <span className="saved-note"> {t('common.saved')}</span>}
                {savingKey === field.key && <span className="saved-note"> {t('common.saving')}</span>}
              </dd>
              {!editing && (
                <button
                  type="button"
                  className="icon-btn prop-edit"
                  onClick={() => startEdit(field)}
                  title={t('common.edit')}
                  aria-label={t('common.edit')}
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}
      </dl>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
