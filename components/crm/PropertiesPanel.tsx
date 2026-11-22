'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { normalizeFieldUrl } from '@/lib/crm-custom-fields';
import { utcToLocalInput } from '@/lib/utils';
import EmailTakenNotice, { emailTakenFrom, type EmailTakenExisting } from './EmailTakenNotice';

export interface PropField {
  /** Clave del payload PATCH (camelCase, ej. firstName, lifecycleStage).
   *  Con prefijo `custom.<name>` patchea dentro del objeto custom. */
  key: string;
  label: string;
  /** multiselect: `value` es el JSON de la lista elegida. */
  /** datetime: `value` es el instante en UTC de la base; se edita en la hora local
   *  del navegador y se guarda como ISO con Z. Mostrarlo con `display`. */
  type: 'text' | 'select' | 'multiselect' | 'number' | 'date' | 'datetime' | 'textarea';
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
  /** Permisos por campo: la persona lo ve pero no lo edita. */
  readOnly?: boolean;
  /** Descripción de la propiedad: ayuda debajo del nombre. */
  help?: string;
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
  /**
   * Vista previa: el valor nuevo se ve al instante y vuelve al anterior si el
   * guardado falla (con el error debajo del campo, no al pie del panel).
   */
  optimistic?: boolean;
  /** Después de guardar bien (la vista previa vuelve a leer el registro). */
  onSaved?: (key: string) => void;
}

const ERROR_CODES = [
  'invalid_email',
  'missing_name',
  'invalid_input',
  'not_found',
  'invalid_company',
  'invalid_owner',
  'forbidden',
  'field_readonly',
  'value_taken',
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
  optimistic = false,
  onSaved,
}: PropertiesPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Campo del último error (modo optimista: el aviso va debajo de ese campo). */
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** Valores puestos en pantalla mientras se guardan (modo optimista). */
  const [overrides, setOverrides] = useState<Record<string, { value: string; base: string }>>({});
  /** Ya hay un contacto con ese email (undefined = sin aviso). */
  const [taken, setTaken] = useState<EmailTakenExisting | undefined>(undefined);
  const [expanded, setExpanded] = useState(!compactKeys || compactKeys.length === 0);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Propiedades propias guardadas desde la última lectura: el PATCH manda el objeto
   * `custom` entero y, sin esto, dos cambios seguidos antes de releer pisaban el primero.
   */
  const savedCustom = useRef<Record<string, unknown>>({});
  useEffect(() => {
    savedCustom.current = {};
  }, [custom]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editingKey) return;
    const field = fields.find((f) => f.key === editingKey);
    if (field?.type === 'textarea') textareaRef.current?.focus();
    else inputRef.current?.focus();
  }, [editingKey, fields]);

  // Cuando el registro vuelve a leerse con el valor guardado, el valor puesto a mano sobra.
  useEffect(() => {
    setOverrides((cur) => {
      const keys = Object.keys(cur);
      if (!keys.length) return cur;
      const next = { ...cur };
      let changed = false;
      for (const k of keys) {
        const f = fields.find((x) => x.key === k);
        // Llegó el valor leído de nuevo (igual al puesto, o normalizado por el servidor).
        if (!f || f.value === cur[k].value || f.value !== cur[k].base) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [fields]);

  useEffect(() => {
    if (!savedKey) return;
    const timer = setTimeout(() => setSavedKey(null), 1600);
    return () => clearTimeout(timer);
  }, [savedKey]);

  function startEdit(field: PropField) {
    if (field.readOnly) return;
    const current = overrides[field.key]?.value ?? field.value;
    setDraft(field.type === 'datetime' ? utcToLocalInput(current) : current);
    setEditingKey(field.key);
    setError(null);
    setErrorKey(null);
    setTaken(undefined);
  }

  function cancel() {
    setEditingKey(null);
  }

  async function save(field: PropField, raw: string) {
    setEditingKey(null);
    const current = overrides[field.key]?.value ?? field.value;
    if (field.type === 'datetime') {
      if (raw === utcToLocalInput(current)) return;
      const d = raw ? new Date(raw) : null;
      if (d && Number.isNaN(d.getTime())) return;
      raw = d ? d.toISOString() : '';
    }
    if (raw === current) return;
    // Los números no quedan vacíos: si borran el valor, no se guarda nada.
    if (field.type === 'number' && raw === '') return;
    setSavingKey(field.key);
    setError(null);
    setErrorKey(null);
    setTaken(undefined);
    // Optimista: el valor nuevo queda a la vista mientras se guarda.
    if (optimistic) setOverrides((cur) => ({ ...cur, [field.key]: { value: raw, base: fields.find((f) => f.key === field.key)?.value ?? field.value } }));
    const rollback = () => {
      if (!optimistic) return;
      setOverrides((cur) => {
        const next = { ...cur };
        delete next[field.key];
        return next;
      });
    };
    let payload: Record<string, unknown>;
    if (field.key.startsWith('custom.')) {
      const name = field.key.slice(7);
      let v: unknown = raw;
      if (field.type === 'number') v = Number(raw);
      else if (field.type === 'multiselect') v = parseList(raw).length ? parseList(raw) : null;
      else if (field.inputType === 'url') v = raw === '' ? null : normalizeFieldUrl(raw);
      else if (field.boolean) v = raw === '' ? null : raw === 'true';
      else if (raw === '' && field.nullOption) v = null;
      payload = { custom: { ...(custom ?? {}), ...savedCustom.current, [name]: v } };
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
      if (field.key.startsWith('custom.')) savedCustom.current = { ...savedCustom.current, ...((payload.custom as Record<string, unknown>) ?? {}) };
      setSavedKey(field.key);
      router.refresh();
      onSaved?.(field.key);
      return;
    }
    rollback();
    setErrorKey(field.key);
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    // El email nuevo ya es de otro contacto: el aviso lo nombra y lo enlaza (si esta persona lo ve).
    const existing = emailTakenFrom(data);
    if (existing !== undefined) {
      setTaken(existing);
      return;
    }
    setError(
      (ERROR_CODES as readonly string[]).includes(code) ? t(`errors.${code}`) : t('errors.generic'),
    );
  }

  // Funciones de render (no componentes): si fueran componentes definidos acá
  // adentro, cada setDraft crearía un tipo nuevo y React remontaría el input
  // (pierde el foco al primer carácter).
  function renderField(original: PropField) {
    // Modo optimista: el valor que se está guardando (o se acaba de guardar) reemplaza al leído.
    const pending = overrides[original.key]?.value;
    const field: PropField =
      pending === undefined
        ? original
        : { ...original, value: pending, display: original.type === 'select' || original.type === 'multiselect' ? undefined : pending };
    const editing = editingKey === field.key;
    const display =
      pending !== undefined && field.type === 'multiselect'
        ? parseList(pending).map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(', ')
        : field.display ? field.display : field.type === 'select'
        ? (field.options?.find((o) => o.value === field.value)?.label ?? field.value)
        : field.value;
    return (
      <div key={field.key} className="prop-row" data-prop={field.key}>
        <dt className="prop-label">
          {field.label}
          {field.help && (
            <span className="prop-help" data-testid="prop-help">
              {field.help}
            </span>
          )}
        </dt>
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
                onKeyDown={(e) => {
                  // Esc cancela la edición y nada más (no cierra la vista previa que contiene el panel).
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                  }
                }}
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
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                  }
                }}
                onBlur={() => save(field, draft.trim())}
              />
            ) : (
              <input
                ref={inputRef}
                className="input"
                type={
                  field.type === 'number'
                    ? 'number'
                    : field.type === 'date'
                      ? 'date'
                      : field.type === 'datetime'
                        ? 'datetime-local'
                        : field.inputType ?? 'text'
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save(field, draft.trim());
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                  }
                }}
                onBlur={() => save(field, draft.trim())}
              />
            )
          ) : field.readOnly ? (
            <span className={`prop-value prop-readonly${field.value && field.value !== '[]' ? '' : ' empty'}`} data-testid="prop-readonly">
              {field.href && field.value ? (
                <a className="prop-link" href={field.href} target={/^(tel|mailto):/.test(field.href) ? undefined : '_blank'} rel="noreferrer">
                  {display}
                </a>
              ) : (
                display || '—'
              )}
              <span className="sr-only"> ({t('fieldPerms.readOnlyNote')})</span>
            </span>
          ) : field.href && field.value ? (
            <a
              className="prop-value prop-link"
              href={field.href}
              target={/^(tel|mailto):/.test(field.href) ? undefined : '_blank'}
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
          {optimistic && error && errorKey === field.key && (
            <span className="prop-error" role="alert" data-testid="prop-error">
              {error}
            </span>
          )}
        </dd>
        {!editing && field.readOnly && (
          <span className="prop-lock" title={t('fieldPerms.readOnlyNote')} aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="11" width="14" height="9" rx="1" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
        )}
        {!editing && !field.readOnly && (
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

  function renderSection(title: string, fieldKeys: string[]) {
    const sectionFields = fieldKeys
      .map((k) => fields.find((f) => f.key === k))
      .filter(Boolean) as PropField[];
    if (!sectionFields.length) return null;
    return (
      <div key={title} className="prop-section">
        <h3 className="prop-section-title">{title}</h3>
        <dl className="prop-table">
          {sectionFields.map((field) => (
            renderField(field)
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
        {sections.map((s) => renderSection(s.title, s.keys.filter((k) => keysToShow.has(k))))}
        {viewAllLabel && compactKeys && (
          <button
            type="button"
            className="btn btn-secondary btn-sm prop-view-all"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t('common.close') : viewAllLabel}
          </button>
        )}
        {error && !(optimistic && errorKey) && <p className="ui-error" role="alert">{error}</p>}
        {taken !== undefined && <EmailTakenNotice existing={taken} />}
      </div>
    );
  }

  return (
    <div>
      <dl className="prop-table">
        {visibleFields.map((field) => (
          renderField(field)
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
      {error && !(optimistic && errorKey) && <p className="ui-error" role="alert">{error}</p>}
      {taken !== undefined && <EmailTakenNotice existing={taken} />}
    </div>
  );
}
