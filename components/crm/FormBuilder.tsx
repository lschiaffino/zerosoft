'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  COMPANY_FORM_PROPS,
  CONTACT_FORM_PROPS,
  FORM_FIELD_TYPES,
  UTM_PARAMS,
  type FormField,
  type FormFieldType,
  type FormSettings,
  type FormStatus,
} from '@/lib/crm-forms-schema';
import { LEAD_STATUSES, LIFECYCLE_STAGES, SOURCES } from '@/lib/crm-constants';

interface Option {
  id: string;
  label: string;
}

interface Props {
  formId: string;
  initial: { name: string; slug: string; status: FormStatus; fields: FormField[]; settings: FormSettings };
  canEdit: boolean;
  hostedUrl: string;
  contactCustomFields: Array<{ name: string; label: string }>;
  companyCustomFields: Array<{ name: string; label: string }>;
  owners: Option[];
  lists: Option[];
  tags: Option[];
  sequences: Option[];
}

const KNOWN_ERRORS = new Set([
  'slug_taken',
  'invalid_slug',
  'invalid_field',
  'duplicate_field',
  'missing_options',
  'invalid_owner',
  'invalid_list',
  'invalid_sequence',
  'invalid_url',
  'invalid_input',
]);

function newFieldId(fields: FormField[], base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'field';
  let id = clean;
  let n = 2;
  while (fields.some((f) => f.id === id)) id = `${clean}_${n++}`;
  return id;
}

/**
 * Builder de formularios: campos (tipo, label, mapeo a propiedad de contacto o
 * empresa incl. custom fields, requerido, opciones, parámetro de URL para
 * ocultos) y ajustes (textos, después de enviar, qué hacer con el contacto,
 * avisos y anti-spam). Guarda todo junto con PATCH.
 */
export default function FormBuilder(props: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const { canEdit } = props;
  const [name, setName] = useState(props.initial.name);
  const [slug, setSlug] = useState(props.initial.slug);
  const [status, setStatus] = useState<FormStatus>(props.initial.status);
  const [fields, setFields] = useState<FormField[]>(props.initial.fields);
  const [settings, setSettings] = useState<FormSettings>(props.initial.settings);
  const [open, setOpen] = useState<string | null>(null);
  const [autoIds, setAutoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailsText, setEmailsText] = useState(props.initial.settings.notifyEmails.join(', '));

  function setS<K extends keyof FormSettings>(key: K, value: FormSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function updateField(i: number, patch: Partial<FormField>) {
    const current = fields[i];
    // Campo agregado en esta sesión: su clave sigue a la etiqueta hasta que se edite a mano.
    if (current && patch.label !== undefined && patch.id === undefined && autoIds.includes(current.id)) {
      const others = fields.filter((_, idx) => idx !== i);
      const id = newFieldId(others, patch.label || 'field');
      patch = { ...patch, id };
      setAutoIds((prev) => prev.map((x) => (x === current.id ? id : x)));
      if (open === current.id) setOpen(id);
    } else if (current && patch.id !== undefined) {
      setAutoIds((prev) => prev.filter((x) => x !== current.id));
      if (open === current.id) setOpen(patch.id);
    }
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
    setSaved(false);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    setFields((prev) => {
      const copy = [...prev];
      const [x] = copy.splice(i, 1);
      copy.splice(j, 0, x);
      return copy;
    });
    setSaved(false);
  }

  function addField() {
    const id = newFieldId(fields, 'field');
    setFields((prev) => [...prev, { id, type: 'text', label: '', property: '', required: false }]);
    setAutoIds((prev) => [...prev, id]);
    setOpen(id);
    setSaved(false);
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
    setSaved(false);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const notifyEmails = emailsText
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const res = await fetch(`/api/crm/forms/${props.formId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || props.initial.name,
        slug: slug.trim() ? slug.trim().toLowerCase() : null,
        status,
        fields: fields.map((f) => ({
          ...f,
          label: f.label.trim(),
          options: f.type === 'select' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined,
          urlParam: f.type === 'hidden' ? f.urlParam || undefined : undefined,
          placeholder: f.placeholder || undefined,
          defaultValue: f.defaultValue || undefined,
        })),
        settings: { ...settings, notifyEmails },
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setSaved(true);
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `forms.errors.${code}` : 'errors.generic'));
  }

  async function remove() {
    if (!confirm(t('forms.deleteConfirm'))) return;
    const res = await fetch(`/api/crm/forms/${props.formId}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) router.push('/app/crm/forms');
  }

  const propertyOptions = (
    <>
      <option value="">{t('forms.builder.noProperty')}</option>
      <optgroup label={t('forms.builder.contact')}>
        {CONTACT_FORM_PROPS.map((p) => (
          <option key={p} value={p}>
            {t(`forms.props.${p}`)}
          </option>
        ))}
        {props.contactCustomFields.map((cf) => (
          <option key={cf.name} value={`custom.${cf.name}`}>
            {cf.label}
          </option>
        ))}
      </optgroup>
      <optgroup label={t('forms.builder.company')}>
        {COMPANY_FORM_PROPS.map((p) => (
          <option key={p} value={`company.${p}`}>
            {t(`forms.companyProps.${p}`)}
          </option>
        ))}
        {props.companyCustomFields.map((cf) => (
          <option key={cf.name} value={`company.custom.${cf.name}`}>
            {cf.label}
          </option>
        ))}
      </optgroup>
    </>
  );

  return (
    <div className="fb">
      <div className="fb-main">
        <section className="fb-section">
          <header className="fb-section-head">
            <h2>{t('forms.builder.fields')}</h2>
            <p className="muted">{t('forms.builder.fieldsDesc')}</p>
          </header>
          <ol className="fb-fields">
            {fields.map((f, i) => (
              <li key={i} className="fb-field" data-testid="form-field-row">
                <div className="fb-field-row">
                  <input
                    className="input fb-label"
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    aria-label={t('forms.builder.label')}
                    placeholder={t('forms.builder.label')}
                    disabled={!canEdit}
                  />
                  <select
                    className="filter-select"
                    value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value as FormFieldType })}
                    aria-label={t('forms.builder.type')}
                    disabled={!canEdit}
                  >
                    {FORM_FIELD_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {t(`forms.types.${ft}`)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="filter-select"
                    value={f.property}
                    onChange={(e) => updateField(i, { property: e.target.value })}
                    aria-label={t('forms.builder.property')}
                    disabled={!canEdit}
                  >
                    {propertyOptions}
                  </select>
                  <label className="fb-req">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                      disabled={!canEdit || f.type === 'hidden'}
                    />
                    {t('forms.builder.required')}
                  </label>
                  <div className="fb-field-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setOpen(open === f.id ? null : f.id)}
                      aria-expanded={open === f.id}
                    >
                      {t('forms.builder.more')}
                    </button>
                    <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={!canEdit || i === 0} aria-label="↑">
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => move(i, 1)}
                      disabled={!canEdit || i === fields.length - 1}
                      aria-label="↓"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => removeField(i)}
                      disabled={!canEdit || fields.length <= 1}
                      aria-label={t('common.delete')}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {open === f.id && (
                  <div className="fb-field-more">
                    <label className="fb-inline">
                      <span>{t('forms.builder.key')}</span>
                      <input
                        className="input mono"
                        value={f.id}
                        onChange={(e) => updateField(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) })}
                        disabled={!canEdit}
                      />
                    </label>
                    {f.type !== 'hidden' && f.type !== 'checkbox' && (
                      <label className="fb-inline">
                        <span>{t('forms.builder.placeholder')}</span>
                        <input
                          className="input"
                          value={f.placeholder ?? ''}
                          onChange={(e) => updateField(i, { placeholder: e.target.value })}
                          disabled={!canEdit}
                        />
                      </label>
                    )}
                    {f.type === 'select' && (
                      <label className="fb-inline">
                        <span>{t('forms.builder.options')}</span>
                        <textarea
                          className="textarea"
                          rows={3}
                          value={(f.options ?? []).join('\n')}
                          onChange={(e) => updateField(i, { options: e.target.value.split('\n') })}
                          placeholder={t('forms.builder.optionsHint')}
                          disabled={!canEdit}
                        />
                      </label>
                    )}
                    {f.type === 'hidden' && (
                      <>
                        <label className="fb-inline">
                          <span>{t('forms.builder.urlParam')}</span>
                          <input
                            className="input mono"
                            list={`utm-${f.id}`}
                            value={f.urlParam ?? ''}
                            onChange={(e) => updateField(i, { urlParam: e.target.value.replace(/[^\w-]/g, '') })}
                            placeholder="utm_source"
                            disabled={!canEdit}
                          />
                          <datalist id={`utm-${f.id}`}>
                            {UTM_PARAMS.map((p) => (
                              <option key={p} value={p} />
                            ))}
                          </datalist>
                        </label>
                        <label className="fb-inline">
                          <span>{t('forms.builder.defaultValue')}</span>
                          <input
                            className="input"
                            value={f.defaultValue ?? ''}
                            onChange={(e) => updateField(i, { defaultValue: e.target.value })}
                            disabled={!canEdit}
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {canEdit && (
            <button type="button" className="btn btn-small" onClick={addField} data-testid="form-add-field">
              {t('forms.builder.addField')}
            </button>
          )}
        </section>

        <section className="fb-section">
          <header className="fb-section-head">
            <h2>{t('forms.builder.display')}</h2>
          </header>
          <div className="fb-grid">
            <label className="fb-inline">
              <span>{t('forms.name')}</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
            </label>
            <label className="fb-inline">
              <span>{t('forms.builder.slug')}</span>
              <input
                className="input mono"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder={t('forms.builder.slugHint')}
                disabled={!canEdit}
              />
            </label>
            <label className="fb-inline">
              <span>{t('forms.builder.title')}</span>
              <input className="input" value={settings.title} onChange={(e) => setS('title', e.target.value)} disabled={!canEdit} />
            </label>
            <label className="fb-inline">
              <span>{t('forms.builder.submitText')}</span>
              <input
                className="input"
                value={settings.submitText}
                onChange={(e) => setS('submitText', e.target.value)}
                disabled={!canEdit}
              />
            </label>
            <label className="fb-inline fb-span">
              <span>{t('forms.builder.description')}</span>
              <textarea
                className="textarea"
                rows={2}
                value={settings.description}
                onChange={(e) => setS('description', e.target.value)}
                disabled={!canEdit}
              />
            </label>
            <label className="fb-inline fb-span">
              <span>{t('forms.builder.consentText')}</span>
              <textarea
                className="textarea"
                rows={2}
                value={settings.consentText}
                onChange={(e) => setS('consentText', e.target.value)}
                placeholder={t('forms.builder.consentPlaceholder')}
                disabled={!canEdit}
              />
            </label>
            <label className="fb-check">
              <input
                type="checkbox"
                checked={settings.consentRequired}
                onChange={(e) => setS('consentRequired', e.target.checked)}
                disabled={!canEdit || !settings.consentText}
              />
              {t('forms.builder.consentRequired')}
            </label>
          </div>
        </section>

        <section className="fb-section">
          <header className="fb-section-head">
            <h2>{t('forms.builder.after')}</h2>
          </header>
          <div className="fb-grid">
            <label className="fb-inline">
              <span>{t('forms.builder.successMode')}</span>
              <select
                className="filter-select"
                value={settings.successMode}
                onChange={(e) => setS('successMode', e.target.value as FormSettings['successMode'])}
                disabled={!canEdit}
              >
                <option value="message">{t('forms.builder.showMessage')}</option>
                <option value="redirect">{t('forms.builder.redirect')}</option>
              </select>
            </label>
            {settings.successMode === 'redirect' ? (
              <label className="fb-inline">
                <span>{t('forms.builder.redirectUrl')}</span>
                <input
                  className="input"
                  type="url"
                  value={settings.redirectUrl}
                  onChange={(e) => setS('redirectUrl', e.target.value)}
                  placeholder="https://"
                  disabled={!canEdit}
                />
              </label>
            ) : (
              <label className="fb-inline fb-span">
                <span>{t('forms.builder.successMessage')}</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={settings.successMessage}
                  onChange={(e) => setS('successMessage', e.target.value)}
                  disabled={!canEdit}
                />
              </label>
            )}
          </div>
        </section>
      </div>

      <aside className="fb-side">
        <section className="fb-section">
          <header className="fb-section-head">
            <h2>{t('forms.builder.crm')}</h2>
            <p className="muted">{t('forms.builder.crmDesc')}</p>
          </header>
          <div className="fb-stack">
            <label className="fb-check">
              <input
                type="checkbox"
                checked={settings.updateExisting}
                onChange={(e) => setS('updateExisting', e.target.checked)}
                disabled={!canEdit}
              />
              {t('forms.builder.dedupe')}
            </label>
            <label className="fb-inline">
              <span>{t('filters.field.lifecycle')}</span>
              <select
                className="filter-select"
                value={settings.lifecycleStage}
                onChange={(e) => setS('lifecycleStage', e.target.value)}
                disabled={!canEdit}
              >
                <option value="">—</option>
                {LIFECYCLE_STAGES.map((v) => (
                  <option key={v} value={v}>
                    {t(`enums.lifecycle.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-inline">
              <span>{t('filters.field.leadStatus')}</span>
              <select
                className="filter-select"
                value={settings.leadStatus}
                onChange={(e) => setS('leadStatus', e.target.value)}
                disabled={!canEdit}
              >
                <option value="">—</option>
                {LEAD_STATUSES.map((v) => (
                  <option key={v} value={v}>
                    {t(`enums.leadStatus.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-inline">
              <span>{t('filters.field.source')}</span>
              <select className="filter-select" value={settings.source} onChange={(e) => setS('source', e.target.value)} disabled={!canEdit}>
                {SOURCES.map((v) => (
                  <option key={v} value={v}>
                    {t(`enums.source.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-inline">
              <span>{t('filters.field.owner')}</span>
              <select className="filter-select" value={settings.ownerId} onChange={(e) => setS('ownerId', e.target.value)} disabled={!canEdit}>
                <option value="">{t('forms.builder.ownerAuto')}</option>
                {props.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-inline">
              <span>{t('forms.builder.list')}</span>
              <select className="filter-select" value={settings.listId} onChange={(e) => setS('listId', e.target.value)} disabled={!canEdit}>
                <option value="">—</option>
                {props.lists.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-inline">
              <span>{t('forms.builder.sequence')}</span>
              <select
                className="filter-select"
                value={settings.sequenceId}
                onChange={(e) => setS('sequenceId', e.target.value)}
                disabled={!canEdit}
              >
                <option value="">—</option>
                {props.sequences.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {props.tags.length > 0 && (
              <fieldset className="fb-tags">
                <legend>{t('forms.builder.tags')}</legend>
                {props.tags.map((tag) => (
                  <label key={tag.id} className="fb-check">
                    <input
                      type="checkbox"
                      checked={settings.tagIds.includes(tag.id)}
                      onChange={(e) =>
                        setS(
                          'tagIds',
                          e.target.checked ? [...settings.tagIds, tag.id] : settings.tagIds.filter((x) => x !== tag.id),
                        )
                      }
                      disabled={!canEdit}
                    />
                    {tag.label}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        </section>

        <section className="fb-section">
          <header className="fb-section-head">
            <h2>{t('forms.builder.notify')}</h2>
          </header>
          <div className="fb-stack">
            <label className="fb-check">
              <input
                type="checkbox"
                checked={settings.notifyOwner}
                onChange={(e) => setS('notifyOwner', e.target.checked)}
                disabled={!canEdit}
              />
              {t('forms.builder.notifyOwner')}
            </label>
            <label className="fb-inline">
              <span>{t('forms.builder.notifyEmails')}</span>
              <input
                className="input"
                value={emailsText}
                onChange={(e) => {
                  setEmailsText(e.target.value);
                  setSaved(false);
                }}
                placeholder="sales@company.com"
                disabled={!canEdit}
              />
            </label>
          </div>
        </section>

        <section className="fb-section">
          <header className="fb-section-head">
            <h2>{t('forms.builder.spam')}</h2>
            <p className="muted">{t('forms.builder.spamDesc')}</p>
          </header>
          <div className="fb-stack">
            <label className="fb-inline">
              <span>{t('forms.builder.minSeconds')}</span>
              <input
                className="input mono"
                type="number"
                min={0}
                max={60}
                value={settings.minSubmitSeconds}
                onChange={(e) => setS('minSubmitSeconds', Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                disabled={!canEdit}
              />
            </label>
            <label className="fb-inline">
              <span>{t('forms.builder.status')}</span>
              <select
                className="filter-select"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as FormStatus);
                  setSaved(false);
                }}
                disabled={!canEdit}
              >
                {(['active', 'paused', 'archived'] as const).map((st) => (
                  <option key={st} value={st}>
                    {t(`forms.status.${st}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </aside>

      <div className="fb-savebar">
        {error && <p className="form-error">{error}</p>}
        {saved && !error && <span className="mono muted">{t('forms.builder.saved')}</span>}
        {canEdit ? (
          <>
            <button type="button" className="btn btn-ghost danger btn-small" onClick={remove}>
              {t('common.delete')}
            </button>
            <a className="btn btn-small" href={props.hostedUrl} target="_blank" rel="noreferrer">
              {t('forms.builder.preview')}
            </a>
            <button type="button" className="btn btn-solid btn-small" onClick={save} disabled={busy} data-testid="form-save">
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        ) : (
          <span className="muted">{t('forms.builder.readOnly')}</span>
        )}
      </div>
    </div>
  );
}
