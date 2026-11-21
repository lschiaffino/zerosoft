'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { CRM_CUSTOM_FIELD_TYPES, type CrmCustomFieldRow } from '@/lib/schema/types';
import { fieldCurrency, UNIQUE_FIELD_ENTITIES, UNIQUE_FIELD_TYPES } from '@/lib/crm-custom-fields';
import { RemoveIcon } from './RowTools';

interface CustomFieldsPanelProps {
  initialFields: CrmCustomFieldRow[];
  /**
   * Entidades que se pueden elegir (valor + label). Sin la prop: contactos,
   * empresas, deals y leads. Los objetos propios usan `obj:<id>`.
   */
  entities?: Array<{ value: string; label: string }>;
  /** Owner/admin: puede pedir valor único (regla de todo el workspace). */
  canEditUnique?: boolean;
}

const FIXED_ENTITIES = ['contacts', 'companies', 'deals', 'leads'] as const;
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
/** ¿El campo admite valor único? Contactos, empresas y deals; texto, número, url o teléfono. */
function uniqueAllowed(f: Pick<CrmCustomFieldRow, 'entity' | 'type'>): boolean {
  return (UNIQUE_FIELD_ENTITIES as readonly string[]).includes(f.entity) && UNIQUE_FIELD_TYPES.has(f.type);
}

export default function CustomFieldsPanel({ initialFields, entities, canEditUnique = false }: CustomFieldsPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const ENTITIES = entities ?? FIXED_ENTITIES.map((value) => ({ value, label: t(`settings.entities.${value}`) }));
  const [fields, setFields] = useState<CrmCustomFieldRow[]>(initialFields);
  const [entity, setEntity] = useState<string>(ENTITIES[0]?.value ?? 'contacts');
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>('text');
  const [options, setOptions] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [group, setGroup] = useState('');
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
        group: group.trim(),
      }),
    });
    if (status === 201 && data) {
      setFields((prev) => [...prev, data as CrmCustomFieldRow]);
      setLabel('');
      setName('');
      setNameTouched(false);
      setType('text');
      setOptions('');
      setGroup('');
      flashSaved();
      router.refresh();
    } else {
      setError(errorText(data));
    }
    setBusy(false);
  }

  async function onPatch(
    id: string,
    patch: { label?: string; options?: string[]; group?: string; description?: string; isUnique?: boolean },
  ) {
    // Sin cortar por `busy`: un blur mientras otro guardado está en vuelo no se pierde.
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

  /** Grupos ya usados en cada objeto (sugerencias del campo Grupo). */
  function groupListId(ent: string): string {
    return `cf-groups-${ent.replace(/[^a-z0-9]/gi, '-')}`;
  }
  const groupsByEntity = new Map<string, string[]>();
  for (const f of fields) {
    const g = (f.group_name ?? '').trim();
    if (!g) continue;
    const list = groupsByEntity.get(f.entity) ?? [];
    if (!list.some((x) => x.toLowerCase() === g.toLowerCase())) list.push(g);
    groupsByEntity.set(f.entity, list);
  }

  return (
    <div className="cf-panel">
      {ENTITIES.map((en) => (
        <datalist key={en.value} id={groupListId(en.value)}>
          {(groupsByEntity.get(en.value) ?? []).map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      ))}
      <form className="cf-create" onSubmit={onCreate}>
        {ENTITIES.length > 1 && (
          <select
            className="filter-select"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            aria-label={t('settings.fieldEntity')}
          >
            {ENTITIES.map((en) => (
              <option key={en.value} value={en.value}>
                {en.label}
              </option>
            ))}
          </select>
        )}
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
        <input
          className="input"
          type="text"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder={t('settings.fieldGroup')}
          aria-label={t('settings.fieldGroup')}
          list={groupListId(entity)}
          maxLength={80}
          data-testid="cf-create-group"
        />
        <button type="submit" className="btn btn-solid btn-small" disabled={busy || !label.trim()}>
          {busy ? t('common.creating') : t('settings.newField')}
        </button>
      </form>

      <div className="cf-feedback">
        {saved && <span className="saved-note">{t('common.saved')}</span>}
        {error && <p className="form-error">{error}</p>}
      </div>

      {fields.filter((f) => ENTITIES.some((en) => en.value === f.entity)).length === 0 ? (
        <p className="muted">{t('settings.noFields')}</p>
      ) : (
        ENTITIES.map((en) => {
          const rows = fields.filter((f) => f.entity === en.value);
          if (rows.length === 0) return null;
          return (
            <div className="cf-group" key={en.value}>
              {ENTITIES.length > 1 && <p className="label cf-group-title">{en.label}</p>}
              {rows.map((f) => (
                <div className="cf-item" key={f.id} data-testid="cf-item" data-field={f.name}>
                <div className="cf-row">
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
                <div className="cf-meta">
                  <label className="cf-meta-field">
                    <span className="cf-meta-label">{t('settings.fieldGroup')}</span>
                    <input
                      className="input"
                      type="text"
                      defaultValue={f.group_name ?? ''}
                      placeholder={t('settings.fieldGroupHint')}
                      aria-label={`${t('settings.fieldGroup')}: ${f.label}`}
                      list={groupListId(f.entity)}
                      maxLength={80}
                      data-testid="cf-group"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (f.group_name ?? '')) onPatch(f.id, { group: v });
                      }}
                    />
                  </label>
                  <label className="cf-meta-field cf-desc">
                    <span className="cf-meta-label">{t('settings.fieldDescription')}</span>
                    <input
                      className="input"
                      type="text"
                      defaultValue={f.description ?? ''}
                      placeholder={t('settings.fieldDescriptionHint')}
                      aria-label={`${t('settings.fieldDescription')}: ${f.label}`}
                      maxLength={500}
                      data-testid="cf-description"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (f.description ?? '')) onPatch(f.id, { description: v });
                      }}
                    />
                  </label>
                  {uniqueAllowed(f) && (
                    <label
                      className="ui-check cf-unique"
                      title={canEditUnique ? t('settings.fieldUniqueHelp') : t('settings.fieldUniqueAdmin')}
                    >
                      <input
                        type="checkbox"
                        checked={!!f.is_unique}
                        disabled={!canEditUnique || busy}
                        onChange={(e) => onPatch(f.id, { isUnique: e.target.checked })}
                        data-testid="cf-unique"
                      />
                      <span>{t('settings.fieldUnique')}</span>
                    </label>
                  )}
                </div>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
