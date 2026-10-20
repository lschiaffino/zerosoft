'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { normalizeFieldUrl } from '@/lib/crm-custom-fields';

export interface PropField {
  /** Clave del payload PATCH (camelCase, ej. firstName, lifecycleStage).
   *  Con prefijo `custom.<name>` patchea dentro del objeto custom. */
  key: string;
  label: string;
  /** multiselect: `value` es el JSON de la lista elegida. */
  type: 'text' | 'select' | 'multiselect' | 'number' | 'date' | 'textarea';
  /** Valor actual ('' si está vacío). */
  value: string;
  /** Opciones para type=select. */
  options?: Array<{ value: string; label: string }>;
  /** En select: la opción vacía envía null en vez de ''. */
  nullOption?: boolean;
  /** Custom field boolean: el select 'true'/'false' se guarda como boolean. */
  boolean?: boolean;
  /** Texto a mostrar fuera de edición (ej. monto con moneda, fecha legible). */
  display?: string;
  /** Link del valor fuera de edición (URL o tel:). */
  href?: string;
  /** Tipo del input de texto (url normaliza a https:// al guardar). */
  inputType?: 'url' | 'tel';
}

function parseList(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface PropSection {
  title: string;
  keys: string[];
}

interface PropertiesPanelProps {
  endpoint: string;
  fields: PropField[];
  /** Objeto custom actual del registro (necesario para mergear campos `custom.*`). */
  custom?: Record<string, unknown>;
  /** Secciones para agrupar propiedades. Si no se pasan se renderiza una lista plana. */
  sections?: PropSection[];
  /** Claves a mostrar en modo compacto. Requiere `viewAllLabel` para expandir. */
  compactKeys?: string[];
  /** Label del botón "Ver todas las propiedades". Si se pasa, activa modo compacto. */
  viewAllLabel?: string;
}

const ERROR_CODES = [
  'invalid_email',
  'missing_name',
  'invalid_input',
  'not_found',
  'invalid_company',
  'invalid_owner',
  'forbidden',
] as const;

/**
 * dl editable inline: click en el valor (o en ✎) → input/select →
 * PATCH al endpoint y "Saved ✓" transitorio. Genérico: sirve para
 * contacts, companies y deals cambiando endpoint + fields.
 */
export default function PropertiesPanel({
  endpoint,
  fields,
  custom,
  sections,
  compactKeys,
  viewAllLabel,
}: PropertiesPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(!compactKeys || compactKeys.length === 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editingKey) return;
    const field = fields.find((f) => f.key === editingKey);
    if (field?.type === 'textarea') textareaRef.current?.focus();
    else inputRef.current?.focus();
  }, [editingKey, fields]);

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
      else if (field.type === 'multiselect') v = parseList(raw).length ? parseList(raw) : null;
      else if (field.inputType === 'url') v = raw === '' ? null : normalizeFieldUrl(raw);
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

  function FieldRow({ field }: { field: PropField }) {
    const editing = editingKey === field.key;
    const display =
      field.display ? field.display : field.type === 'select'
        ? (field.options?.find((o) => o.value === field.value)?.label ?? field.value)
        : field.value;
    return (
      <div key={field.key} className="prop-row">
        <dt className="prop-label">{field.label}</dt>
        <dd className="prop-value">
          {editing ? (
            field.type === 'multiselect' ? (
              <div className="prop-multi">
                {field.options?.map((opt) => {
                  const list = parseList(draft);
                  return (
                    <label key={opt.value} className="ui-check">
                      <input
                        type="checkbox"
                        checked={list.includes(opt.value)}
                        onChange={(e) =>
                          setDraft(
                            JSON.stringify(
                              (field.options ?? [])
                                .map((o) => o.value)
                                .filter((v) => (v === opt.value ? e.target.checked : list.includes(v))),
                            ),
                          )
                        }
                      />
                      <span>{opt.label}</span>
                    </label>
                  );
                })}
                <div className="form-actions">
                  <button type="button" className="btn btn-solid btn-small" onClick={() => save(field, draft)}>
                    {t('common.save')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={cancel}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : field.type === 'select' ? (
              <select
                className="select"
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
            ) : field.type === 'textarea' ? (
              <textarea
                ref={textareaRef}
                className="textarea"
                value={draft}
                rows={4}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancel();
                }}
                onBlur={() => save(field, draft.trim())}
              />
            ) : (
              <input
                ref={inputRef}
                className="input"
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.inputType ?? 'text'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save(field, draft.trim());
                  if (e.key === 'Escape') cancel();
                }}
                onBlur={() => save(field, draft.trim())}
              />
            )
          ) : field.href && field.value ? (
            <a
              className="prop-value prop-link"
              href={field.href}
              target={field.href.startsWith('tel:') ? undefined : '_blank'}
              rel="noreferrer"
            >
              {display}
            </a>
          ) : (
            <button
              type="button"
              className={`prop-value prop-btn${field.value && field.value !== '[]' ? '' : ' empty'}`}
              onClick={() => startEdit(field)}
            >
              {display || '—'}
            </button>
          )}
          {savedKey === field.key && <span className="saved-note" role="status"> {t('common.saved')}</span>}
          {savingKey === field.key && <span className="saved-note" role="status"> {t('common.saving')}</span>}
        </dd>
        {!editing && (
          <button
            type="button"
            className="icon-btn prop-edit"
            onClick={() => startEdit(field)}
            title={t('common.edit')}
            aria-label={t('common.edit')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  function Section({ title, fieldKeys }: { title: string; fieldKeys: string[] }) {
    const sectionFields = fieldKeys
      .map((k) => fields.find((f) => f.key === k))
      .filter(Boolean) as PropField[];
    if (!sectionFields.length) return null;
    return (
      <div className="prop-section">
        <h3 className="prop-section-title">{title}</h3>
        <dl className="prop-table">
          {sectionFields.map((field) => (
            <FieldRow key={field.key} field={field} />
          ))}
        </dl>
      </div>
    );
  }

  const visibleKeys = expanded ? fields.map((f) => f.key) : compactKeys;
  const visibleFields = visibleKeys
    ? (visibleKeys.map((k) => fields.find((f) => f.key === k)).filter(Boolean) as PropField[])
    : fields;

  if (sections && sections.length > 0) {
    const keysToShow = new Set(visibleFields.map((f) => f.key));
    return (
      <div>
        {sections.map((s) => (
          <Section
            key={s.title}
            title={s.title}
            fieldKeys={s.keys.filter((k) => keysToShow.has(k))}
          />
        ))}
        {viewAllLabel && compactKeys && (
          <button
            type="button"
            className="btn btn-secondary btn-sm prop-view-all"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t('common.close') : viewAllLabel}
          </button>
        )}
        {error && <p className="ui-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <dl className="prop-table">
        {visibleFields.map((field) => (
          <FieldRow key={field.key} field={field} />
        ))}
      </dl>
      {viewAllLabel && compactKeys && (
        <button
          type="button"
          className="btn btn-secondary btn-sm prop-view-all"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('common.close') : viewAllLabel}
        </button>
      )}
      {error && <p className="ui-error" role="alert">{error}</p>}
    </div>
  );
}
