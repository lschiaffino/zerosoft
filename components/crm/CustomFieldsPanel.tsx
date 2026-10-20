'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { CRM_CUSTOM_FIELD_TYPES, type CrmCustomFieldRow } from '@/lib/schema/types';
import { fieldCurrency } from '@/lib/crm-custom-fields';
import { RemoveIcon } from './RowTools';

interface CustomFieldsPanelProps {
  initialFields: CrmCustomFieldRow[];
}

const ENTITIES = ['contacts', 'companies', 'deals'] as const;
const TYPES = CRM_CUSTOM_FIELD_TYPES;
/** Tipos con lista de opciones (separadas por coma). */
const WITH_OPTIONS = new Set<string>(['select', 'multiselect']);
const CURRENCIES = ['USD', 'EUR', 'GBP', 'ARS', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'CAD', 'AUD', 'JPY'];

/** Slug válido para el schema: /^[a-z][a-z0-9_]*$/. */
function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!slug) return '';
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`;
}

function parseOptions(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

/** Alta, edición inline y borrado de custom fields por entidad. */
export default function CustomFieldsPanel({ initialFields }: CustomFieldsPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [fields, setFields] = useState<CrmCustomFieldRow[]>(initialFields);
  const [entity, setEntity] = useState<(typeof ENTITIES)[number]>('contacts');
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>('text');
  const [options, setOptions] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  async function api(path: string, init: RequestInit): Promise<{ status: number; data: unknown }> {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    }).catch(() => null);
    if (!res) return { status: 0, data: null };
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data };
  }

  function errorText(data: unknown): string {
    const code = (data as { error?: string } | null)?.error;
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  }

  function optionsArray(): string[] {
    return options
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const finalName = (nameTouched ? name : slugify(label)) || slugify(label);
    if (!label.trim() || !finalName || busy) return;
    setError(null);
    setBusy(true);
    const { status, data } = await api('/api/crm/custom-fields', {
      method: 'POST',
      body: JSON.stringify({
        entity,
        name: finalName,
        label: label.trim(),
        type,
        options: WITH_OPTIONS.has(type) ? optionsArray() : type === 'currency' ? [currency] : [],
        position: fields.filter((f) => f.entity === entity).length,
      }),
    });
    if (status === 201 && data) {
      setFields((prev) => [...prev, data as CrmCustomFieldRow]);
      setLabel('');
      setName('');
      setNameTouched(false);
      setType('text');
      setOptions('');
      flashSaved();
      router.refresh();
    } else {
      setError(errorText(data));
    }
    setBusy(false);
  }

  async function onPatch(id: string, patch: { label?: string; options?: string[] }) {
    if (busy) return;
    setBusy(true);
    const { status, data } = await api(`/api/crm/custom-fields/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (status === 200 && data) {
      const row = data as CrmCustomFieldRow;
      setFields((prev) => prev.map((f) => (f.id === id ? row : f)));
      setError(null);
      flashSaved();
      router.refresh();
    } else {
      setError(errorText(data));
    }
    setBusy(false);
  }

  async function onDelete(id: string) {
    if (busy) return;
    setBusy(true);
    const { status, data } = await api(`/api/crm/custom-fields/${id}`, { method: 'DELETE' });
    setConfirmId(null);
    if (status === 204) {
      setFields((prev) => prev.filter((f) => f.id !== id));
      flashSaved();
      router.refresh();
    } else {
      setError(errorText(data));
    }
    setBusy(false);
  }

  return (
    <div className="cf-panel">
      <form className="cf-create" onSubmit={onCreate}>
        <select
          className="filter-select"
          value={entity}
          onChange={(e) => setEntity(e.target.value as (typeof ENTITIES)[number])}
          aria-label={t('settings.fieldEntity')}
        >
          {ENTITIES.map((en) => (
            <option key={en} value={en}>
              {t(`settings.entities.${en}`)}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('settings.fieldLabel')}
          aria-label={t('settings.fieldLabel')}
          maxLength={200}
        />
        <input
          className="input mono"
          type="text"
          value={nameTouched ? name : slugify(label)}
          onChange={(e) => {
            setNameTouched(true);
            setName(e.target.value);
          }}
          placeholder={t('settings.fieldName')}
          aria-label={t('settings.fieldName')}
          maxLength={64}
        />
        <select
          className="filter-select"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
          aria-label={t('settings.fieldType')}
        >
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`settings.types.${ty}`)}
            </option>
          ))}
        </select>
        {type === 'currency' && (
          <select
            className="filter-select"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label={t('settings.fieldCurrency')}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {WITH_OPTIONS.has(type) && (
          <input
            className="input"
            type="text"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder={t('settings.fieldOptions')}
            aria-label={t('settings.fieldOptions')}
          />
        )}
        <button type="submit" className="btn btn-solid btn-small" disabled={busy || !label.trim()}>
          {busy ? t('common.creating') : t('settings.newField')}
        </button>
      </form>

      <div className="cf-feedback">
        {saved && <span className="saved-note">{t('common.saved')}</span>}
        {error && <p className="form-error">{error}</p>}
      </div>

      {fields.length === 0 ? (
        <p className="muted">{t('settings.noFields')}</p>
      ) : (
        ENTITIES.map((en) => {
          const rows = fields.filter((f) => f.entity === en);
          if (rows.length === 0) return null;
          return (
            <div className="cf-group" key={en}>
              <p className="label cf-group-title">{t(`settings.entities.${en}`)}</p>
              {rows.map((f) => (
                <div className="cf-row" key={f.id}>
                  <input
                    className="input"
                    type="text"
                    defaultValue={f.label}
                    aria-label={t('settings.fieldLabel')}
                    maxLength={200}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== f.label) onPatch(f.id, { label: v });
                      else if (!v) e.target.value = f.label;
                    }}
                  />
                  <span className="mono cf-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="badge">{t(`settings.types.${f.type}`)}</span>
                  {f.type === 'currency' ? (
                    <select
                      className="filter-select"
                      defaultValue={fieldCurrency(f)}
                      aria-label={t('settings.fieldCurrency')}
                      onChange={(e) => onPatch(f.id, { options: [e.target.value] })}
                    >
                      {[...new Set([fieldCurrency(f), ...CURRENCIES])].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : WITH_OPTIONS.has(f.type) ? (
                    <input
                      className="input"
                      type="text"
                      defaultValue={parseOptions(f.options).join(', ')}
                      aria-label={t('settings.fieldOptions')}
                      onBlur={(e) => {
                        const arr = e.target.value
                          .split(',')
                          .map((o) => o.trim())
                          .filter(Boolean);
                        if (arr.join(',') !== parseOptions(f.options).join(',')) {
                          onPatch(f.id, { options: arr });
                        }
                      }}
                    />
                  ) : (
                    <span className="cf-options-empty" aria-hidden />
                  )}
                  {confirmId === f.id ? (
                    <span className="cell-actions confirm">
                      <span className="confirm-label">{t('settings.confirmDelete')}</span>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => onDelete(f.id)}
                        disabled={busy}
                      >
                        {t('common.yes')}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setConfirmId(null)}
                        disabled={busy}
                      >
                        {t('common.no')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm btn-icon"
                      onClick={() => setConfirmId(f.id)}
                      disabled={busy}
                      title={t('common.delete')}
                      aria-label={`${t('common.delete')}: ${f.label}`}
                    >
                      <RemoveIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
