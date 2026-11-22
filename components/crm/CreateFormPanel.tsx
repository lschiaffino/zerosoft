'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { RemoveIcon } from './RowTools';
import { useFieldLabel } from './CreateFormFields';
import {
  ALWAYS_REQUIRED,
  BUILTIN_FIELDS,
  CORE_FIELDS,
  CREATE_FORM_ENTITIES,
  configuredFields,
  customKey,
  customName,
  isRequirable,
  MAX_CREATE_FORM_FIELDS,
  type CreateFormEntity,
  type CreateFormField,
} from '@/lib/crm-create-form-shared';

export interface CreateFormPanelCustomField {
  entity: string;
  name: string;
  label: string;
  type: string;
}

interface CreateFormPanelProps {
  /** Formulario de cada objeto (para un member, sin lo que tiene oculto). */
  initial: Record<CreateFormEntity, CreateFormField[]>;
  /** Propiedades personalizadas que la persona ve (visibleFieldDefinitions). */
  customFields: CreateFormPanelCustomField[];
  canEdit: boolean;
}

/**
 * Formulario de alta por objeto (Ajustes › Datos), como "Manage create form"
 * de HubSpot: qué propiedades muestra el alta, en qué orden y cuáles son
 * obligatorias. Se guarda con cada cambio. Solo owner y admins lo cambian.
 */
export default function CreateFormPanel({ initial, customFields, canEdit }: CreateFormPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [entity, setEntity] = useState<CreateFormEntity>('contacts');
  const [forms, setForms] = useState(initial);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);
  const label = useFieldLabel(entity);

  const form = forms[entity];
  const customs = customFields.filter((f) => f.entity === entity);
  const customByKey = new Map(customs.map((f) => [customKey(f.name), f]));
  const fieldLabel = (key: string) => label(key, customByKey.get(key));
  const customType = (key: string) => {
    const name = customName(key);
    return name ? customByKey.get(key)?.type : undefined;
  };
  const configured = configuredFields(entity, form);
  const inForm = new Set(configured.map((f) => f.key));
  const available = [
    ...BUILTIN_FIELDS[entity].map((b) => b.key).filter((k) => !inForm.has(k)),
    ...customs.map((f) => customKey(f.name)).filter((k) => !inForm.has(k)),
  ];

  async function save(next: CreateFormField[]) {
    const prev = forms[entity];
    setForms((f) => ({ ...f, [entity]: next }));
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/crm/create-form', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity, fields: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setForms((f) => ({ ...f, [entity]: prev }));
      setStatus({ kind: 'error', text: t('errors.generic') });
      return;
    }
    const saved = (await res.json().catch(() => null)) as { fields?: CreateFormField[] } | null;
    if (saved?.fields) setForms((f) => ({ ...f, [entity]: saved.fields! }));
    setStatus({ kind: 'saved', text: t('createForm.saved') });
    router.refresh();
  }

  async function reset() {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/crm/create-form?entity=${entity}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      const fresh = await fetch(`/api/crm/create-form?entity=${entity}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ fields: CreateFormField[] }>) : null))
        .catch(() => null);
      if (fresh) setForms((f) => ({ ...f, [entity]: fresh.fields.map(({ key, required }) => ({ key, required })) }));
      setStatus({ kind: 'saved', text: t('createForm.saved') });
      router.refresh();
    } else {
      setStatus({ kind: 'error', text: t('errors.generic') });
    }
    setBusy(false);
  }

  const coreRows = CORE_FIELDS[entity].map((key) => ({
    key,
    required: ALWAYS_REQUIRED[entity].includes(key) || form.some((f) => f.key === key && f.required),
  }));
  const coreStored = form.filter((f) => CORE_FIELDS[entity].includes(f.key));

  const setRequired = (key: string, required: boolean) => {
    if (CORE_FIELDS[entity].includes(key)) {
      const core = coreRows
        .filter((r) => !ALWAYS_REQUIRED[entity].includes(r.key))
        .map((r) => ({ key: r.key, required: r.key === key ? required : r.required }))
        .filter((r) => r.required);
      void save([...core, ...configured]);
      return;
    }
    void save([...coreStored, ...configured.map((f) => (f.key === key ? { ...f, required } : f))]);
  };
  const move = (i: number, delta: number) => {
    const next = [...configured];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void save([...coreStored, ...next]);
  };
  const remove = (key: string) => void save([...coreStored, ...configured.filter((f) => f.key !== key)]);
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adding || inForm.has(adding)) return;
    void save([...coreStored, ...configured, { key: adding, required: false }]);
    setAdding('');
  };

  const requiredBox = (key: string, required: boolean, locked: boolean) => (
    <label className="ui-check create-form-req">
      <input
        type="checkbox"
        checked={required}
        disabled={!canEdit || busy || locked}
        onChange={(e) => setRequired(key, e.target.checked)}
        aria-label={`${t('createForm.required')}: ${fieldLabel(key)}`}
        data-testid={`create-form-required-${key}`}
      />
      <span>{t('createForm.required')}</span>
    </label>
  );

  return (
    <div className="create-form" data-testid="create-form-panel">
      <div className="ui-field create-form-object">
        <label className="label" htmlFor="create-form-entity">
          {t('createForm.object')}
        </label>
        <select
          id="create-form-entity"
          className="select"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value as CreateFormEntity);
            setAdding('');
            setStatus(null);
          }}
        >
          {CREATE_FORM_ENTITIES.map((en) => (
            <option key={en} value={en}>
              {t(`settings.entities.${en}`)}
            </option>
          ))}
        </select>
      </div>

      <ol className="create-form-list" data-testid="create-form-list">
        {coreRows.map((r) => (
          <li key={r.key} className="create-form-row" data-testid={`create-form-row-${r.key}`}>
            <span className="create-form-name">
              {fieldLabel(r.key)}
              <span className="muted create-form-note">{t('createForm.always')}</span>
            </span>
            {isRequirable(entity, r.key) || ALWAYS_REQUIRED[entity].includes(r.key)
              ? requiredBox(r.key, r.required, ALWAYS_REQUIRED[entity].includes(r.key))
              : null}
            <span className="create-form-tools" />
          </li>
        ))}
        {configured.map((f, i) => {
          const requirable = isRequirable(entity, f.key, customType(f.key));
          return (
            <li key={f.key} className="create-form-row" data-testid={`create-form-row-${f.key}`}>
              <span className="create-form-name">
                {fieldLabel(f.key)}
                {customName(f.key) && <span className="muted create-form-note">{t('createForm.custom')}</span>}
              </span>
              {requirable ? requiredBox(f.key, f.required, false) : <span />}
              <span className="create-form-tools">
                {canEdit && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(i, -1)}
                      disabled={busy || i === 0}
                      aria-label={`${t('settings.moveUp')}: ${fieldLabel(f.key)}`}
                      title={t('settings.moveUp')}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(i, 1)}
                      disabled={busy || i === configured.length - 1}
                      aria-label={`${t('settings.moveDown')}: ${fieldLabel(f.key)}`}
                      title={t('settings.moveDown')}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm btn-icon"
                      onClick={() => remove(f.key)}
                      disabled={busy}
                      aria-label={`${t('createForm.remove')}: ${fieldLabel(f.key)}`}
                      title={t('createForm.remove')}
                    >
                      <RemoveIcon />
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {canEdit ? (
        <>
          <form className="create-form-add" onSubmit={add}>
            <select
              className="select"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              aria-label={t('createForm.addLabel')}
              disabled={busy || !available.length || configured.length >= MAX_CREATE_FORM_FIELDS}
              data-testid="create-form-add-select"
            >
              <option value="">{available.length ? t('createForm.pick') : t('createForm.none')}</option>
              {available.map((k) => (
                <option key={k} value={k}>
                  {fieldLabel(k)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !adding}>
              {t('createForm.add')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reset()} disabled={busy}>
              {t('createForm.reset')}
            </button>
          </form>
          <p className="ui-help">{t('createForm.help')}</p>
        </>
      ) : (
        <p className="ui-help">{t('common.adminOnly')}</p>
      )}
      {status && (
        <p className={status.kind === 'error' ? 'ui-error' : 'ui-help'} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.text}
        </p>
      )}
    </div>
  );
}
