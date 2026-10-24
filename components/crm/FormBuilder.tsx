'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import AdvancedSection from '@/components/ui/AdvancedSection';
import RowTools from './RowTools';
import { PanelTabs, TabPanel } from './PanelTabs';
import {
  COMPANY_FORM_PROPS,
  CONDITION_OPS,
  CONTACT_FORM_PROPS,
  FORM_FIELD_TYPES,
  type ConditionOp,
  UTM_PARAMS,
  type FormField,
  type FormFieldType,
  type FormSettings,
  type FormStatus,
} from '@/lib/crm-forms-schema';
import { LEAD_STATUSES, LIFECYCLE_STAGES, SOURCES } from '@/lib/crm-constants';
import { builderTabForError, fieldKeyFromLabel, slugFromName, uniqueFieldKey } from '@/lib/crm-forms-builder';

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
  /** Pipelines con sus etapas (crear deal con el envío). */
  pipelines?: Array<{ id: string; name: string; stages: Option[] }>;
  /** CAPTCHA configurado en el servidor (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY). */
  captchaAvailable?: boolean;
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
  'invalid_stage',
]);

type BuilderTab = 'fields' | 'design' | 'after' | 'crm';

/**
 * Builder de formularios en cuatro pestañas (Campos, Diseño, Después del
 * envío, CRM y avisos) dentro de un solo <form>: las pestañas no desmontan
 * nada y un único Guardar manda todo con PATCH. Lo que el camino básico no
 * necesita (URL propia, consentimiento, dedupe, anti-spam, la clave de cada
 * campo) vive en "Avanzado"; las claves se derivan de la etiqueta.
 */
export default function FormBuilder(props: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const idBase = useId();
  const { canEdit } = props;
  const [tab, setTab] = useState<BuilderTab>('fields');
  const [name, setName] = useState(props.initial.name);
  const [slug, setSlug] = useState(props.initial.slug);
  const [status, setStatus] = useState<FormStatus>(props.initial.status);
  const [fields, setFields] = useState<FormField[]>(props.initial.fields);
  const [settings, setSettings] = useState<FormSettings>(props.initial.settings);
  const [open, setOpen] = useState<string | null>(null);
  const [autoIds, setAutoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'dirty' | 'saved'>('idle');
  const [error, setError] = useState<{ message: string; tab: BuilderTab | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [emailsText, setEmailsText] = useState(props.initial.settings.notifyEmails.join(', '));

  const dirty = () => setState('dirty');

  function setS<K extends keyof FormSettings>(key: K, value: FormSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    dirty();
  }

  function updateField(i: number, patch: Partial<FormField>) {
    const current = fields[i];
    // Campo agregado en esta sesión: su clave sigue a la etiqueta hasta que se edite a mano.
    if (current && patch.label !== undefined && patch.id === undefined && autoIds.includes(current.id)) {
      const others = fields.filter((_, idx) => idx !== i);
      const id = uniqueFieldKey(others, fieldKeyFromLabel(patch.label));
      patch = { ...patch, id };
      setAutoIds((prev) => prev.map((x) => (x === current.id ? id : x)));
      if (open === current.id) setOpen(id);
    } else if (current && patch.id !== undefined) {
      setAutoIds((prev) => prev.filter((x) => x !== current.id));
      if (open === current.id) setOpen(patch.id);
    }
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
    dirty();
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
    dirty();
  }

  function addField() {
    const id = uniqueFieldKey(fields, 'field');
    setFields((prev) => [...prev, { id, type: 'text', label: '', property: '', required: false }]);
    setAutoIds((prev) => [...prev, id]);
    dirty();
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
    dirty();
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !canEdit) return;
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
      setState('saved');
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    const errTab = builderTabForError(code);
    setError({ message: t(KNOWN_ERRORS.has(code) ? `forms.errors.${code}` : 'errors.generic'), tab: errTab });
    if (errTab) setTab(errTab);
  }

  async function remove() {
    const res = await fetch(`/api/crm/forms/${props.formId}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) router.push('/app/crm/forms');
    else setError({ message: t('errors.generic'), tab: null });
  }

  const tabs: Array<{ key: BuilderTab; label: string; invalid?: boolean }> = (
    [
      ['fields', t('forms.builder.tabs.fields')],
      ['design', t('forms.builder.tabs.design')],
      ['after', t('forms.builder.tabs.after')],
      ['crm', t('forms.builder.tabs.crm')],
    ] as const
  ).map(([key, label]) => ({ key, label, invalid: error?.tab === key }));

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

  const fid = (k: string) => `${idBase}-${k}`;
  const statusNote =
    busy ? t('common.saving') : error ? error.message : state === 'saved' ? t('forms.builder.saved') : state === 'dirty' ? t('forms.builder.unsaved') : null;

  // En desktop van en la barra; en el celular, debajo del contenido (la barra queda con Guardar solo).
  const secondaryActions = (
    <>
      {confirmDelete ? (
        <>
          <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={remove}>
            {t('forms.builder.confirmDelete')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
          {t('common.delete')}
        </button>
      )}
      <a className="btn btn-secondary btn-sm" href={props.hostedUrl} target="_blank" rel="noreferrer">
        {t('forms.builder.preview')}
      </a>
    </>
  );

  return (
    <form className="fb" onSubmit={save} noValidate>
      <PanelTabs
        items={tabs}
        active={tab}
        onChange={(k) => setTab(k as BuilderTab)}
        idBase={idBase}
        label={t('forms.builder.tabsLabel')}
        level="sub"
      />

      <TabPanel idBase={idBase} tab="fields" active={tab} className="fb-panel">
        <p className="ui-help">{t('forms.builder.fieldsDesc')}</p>
        <div className="fb-field-row fb-field-head" aria-hidden="true">
          <span>{t('forms.builder.label')}</span>
          <span>{t('forms.builder.type')}</span>
          <span>{t('forms.builder.property')}</span>
        </div>
        <ol className="fb-fields">
          {fields.map((f, i) => {
            const more = open === f.id;
            const rowName = f.label || t('forms.builder.untitled');
            return (
              <li key={i} className="fb-field" data-testid="form-field-row">
                <div className="fb-field-row">
                  {/* La cabecera nombra las columnas en desktop; en el celular cada control lleva su rótulo. */}
                  <span className="fb-cell fb-label">
                    <label className="fb-cell-label" htmlFor={fid(`label-${i}`)}>
                      {t('forms.builder.label')}
                    </label>
                    <input
                      id={fid(`label-${i}`)}
                      className="input"
                      value={f.label}
                      onChange={(e) => updateField(i, { label: e.target.value })}
                      disabled={!canEdit}
                    />
                  </span>
                  <span className="fb-cell">
                    <label className="fb-cell-label" htmlFor={fid(`type-${i}`)}>
                      {t('forms.builder.type')}
                    </label>
                    <select
                      id={fid(`type-${i}`)}
                      className="select"
                      value={f.type}
                      onChange={(e) => {
                        const type = e.target.value as FormFieldType;
                        updateField(i, type === 'step' ? { type, property: '', required: false } : { type });
                      }}
                      disabled={!canEdit}
                    >
                      {FORM_FIELD_TYPES.map((ft) => (
                        <option key={ft} value={ft}>
                          {t(`forms.types.${ft}`)}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="fb-cell">
                    <label className="fb-cell-label" htmlFor={fid(`prop-${i}`)}>
                      {t('forms.builder.property')}
                    </label>
                    <select
                      id={fid(`prop-${i}`)}
                      className="select"
                      value={f.property}
                      onChange={(e) => updateField(i, { property: e.target.value })}
                      disabled={!canEdit || f.type === 'step'}
                    >
                      {propertyOptions}
                    </select>
                  </span>
                  <label className="ui-check fb-req">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                      disabled={!canEdit || f.type === 'hidden' || f.type === 'step'}
                    />
                    {t('forms.builder.required')}
                  </label>
                  <span className="fb-field-tools">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setOpen(more ? null : f.id)}
                      aria-expanded={more}
                      aria-controls={fid(`more-${i}`)}
                    >
                      {t('forms.builder.more')}
                    </button>
                    <RowTools
                      index={i}
                      count={fields.length}
                      minCount={1}
                      onMove={(d) => move(i, d)}
                      onRemove={() => removeField(i)}
                      disabled={!canEdit}
                      name={rowName}
                    />
                  </span>
                </div>
                <div className="fb-field-more ui-fields-2" id={fid(`more-${i}`)} hidden={!more}>
                  {f.type !== 'hidden' && f.type !== 'checkbox' && (
                    <div className="ui-field">
                      <label className="label" htmlFor={fid(`ph-${i}`)}>
                        {t('forms.builder.placeholder')}
                      </label>
                      <input
                        id={fid(`ph-${i}`)}
                        className="input"
                        value={f.placeholder ?? ''}
                        onChange={(e) => updateField(i, { placeholder: e.target.value })}
                        disabled={!canEdit}
                      />
                    </div>
                  )}
                  {f.type === 'select' && (
                    <div className="ui-field">
                      <label className="label" htmlFor={fid(`opt-${i}`)}>
                        {t('forms.builder.options')}
                      </label>
                      <textarea
                        id={fid(`opt-${i}`)}
                        className="textarea"
                        rows={3}
                        value={(f.options ?? []).join('\n')}
                        onChange={(e) => updateField(i, { options: e.target.value.split('\n') })}
                        disabled={!canEdit}
                      />
                      <span className="ui-help">{t('forms.builder.optionsHint')}</span>
                    </div>
                  )}
                  {f.type === 'hidden' && (
                    <>
                      <div className="ui-field">
                        <label className="label" htmlFor={fid(`url-${i}`)}>
                          {t('forms.builder.urlParam')}
                        </label>
                        <input
                          id={fid(`url-${i}`)}
                          className="input data"
                          list={fid(`utm-${i}`)}
                          value={f.urlParam ?? ''}
                          onChange={(e) => updateField(i, { urlParam: e.target.value.replace(/[^\w-]/g, '') })}
                          placeholder="utm_source"
                          disabled={!canEdit}
                        />
                        <datalist id={fid(`utm-${i}`)}>
                          {UTM_PARAMS.map((p) => (
                            <option key={p} value={p} />
                          ))}
                        </datalist>
                      </div>
                      <div className="ui-field">
                        <label className="label" htmlFor={fid(`def-${i}`)}>
                          {t('forms.builder.defaultValue')}
                        </label>
                        <input
                          id={fid(`def-${i}`)}
                          className="input"
                          value={f.defaultValue ?? ''}
                          onChange={(e) => updateField(i, { defaultValue: e.target.value })}
                          disabled={!canEdit}
                        />
                      </div>
                    </>
                  )}
                  {f.type !== 'step' && f.type !== 'hidden' && i > 0 && (
                    <fieldset className="fb-condition" data-testid="form-condition">
                      <legend className="label">{t('forms.builder.showIf')}</legend>
                      <select
                        className="select"
                        aria-label={t('forms.builder.showIfField')}
                        value={f.showIf?.field ?? ''}
                        onChange={(e) =>
                          updateField(i, {
                            showIf: e.target.value ? { field: e.target.value, op: f.showIf?.op ?? 'equals', value: f.showIf?.value ?? '' } : undefined,
                          })
                        }
                        disabled={!canEdit}
                      >
                        <option value="">{t('forms.builder.always')}</option>
                        {fields
                          .slice(0, i)
                          .filter((o) => o.type !== 'step' && o.type !== 'hidden')
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label || o.id}
                            </option>
                          ))}
                      </select>
                      {f.showIf && (
                        <>
                          <select
                            className="select"
                            aria-label={t('forms.builder.showIfOp')}
                            value={f.showIf.op}
                            onChange={(e) => updateField(i, { showIf: { ...f.showIf!, op: e.target.value as ConditionOp } })}
                            disabled={!canEdit}
                          >
                            {CONDITION_OPS.map((op) => (
                              <option key={op} value={op}>
                                {t(`forms.builder.ops.${op}`)}
                              </option>
                            ))}
                          </select>
                          {(f.showIf.op === 'equals' || f.showIf.op === 'not_equals') && (
                            <input
                              className="input"
                              aria-label={t('forms.builder.showIfValue')}
                              value={f.showIf.value ?? ''}
                              onChange={(e) => updateField(i, { showIf: { ...f.showIf!, value: e.target.value } })}
                              list={fid(`cond-${i}`)}
                              disabled={!canEdit}
                            />
                          )}
                          <datalist id={fid(`cond-${i}`)}>
                            {(fields.find((o) => o.id === f.showIf?.field)?.options ?? []).map((o) => (
                              <option key={o} value={o} />
                            ))}
                          </datalist>
                        </>
                      )}
                    </fieldset>
                  )}
                  <div className="ui-field">
                    <label className="label" htmlFor={fid(`key-${i}`)}>
                      {t('forms.builder.key')}
                    </label>
                    <input
                      id={fid(`key-${i}`)}
                      className="input data"
                      value={f.id}
                      onChange={(e) => updateField(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) })}
                      disabled={!canEdit}
                    />
                    <span className="ui-help">{t('forms.builder.keyHint')}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {canEdit && (
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addField} data-testid="form-add-field">
              {t('forms.builder.addField')}
            </button>
          </div>
        )}
      </TabPanel>

      <TabPanel idBase={idBase} tab="design" active={tab} className="fb-panel">
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor={fid('title')}>
              {t('forms.builder.title')}
            </label>
            <input id={fid('title')} className="input" value={settings.title} onChange={(e) => setS('title', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('submit')}>
              {t('forms.builder.submitText')}
            </label>
            <input
              id={fid('submit')}
              className="input"
              value={settings.submitText}
              onChange={(e) => setS('submitText', e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={fid('desc')}>
            {t('forms.builder.description')}
          </label>
          <textarea
            id={fid('desc')}
            className="textarea"
            rows={2}
            value={settings.description}
            onChange={(e) => setS('description', e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <AdvancedSection storageKey="crm.form.design" hint={t('forms.builder.designAdvancedHint')} defaultOpen={error?.tab === 'design'}>
          <div className="ui-field">
            <label className="label" htmlFor={fid('slug')}>
              {t('forms.builder.slug')}
            </label>
            <div className="ui-input-group">
              <span className="ui-addon data">/f/</span>
              <input
                id={fid('slug')}
                className="input data"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  dirty();
                }}
                placeholder={slugFromName(name) || t('forms.builder.slugHint')}
                aria-invalid={error?.tab === 'design' || undefined}
                disabled={!canEdit}
              />
            </div>
            {canEdit && !slug && slugFromName(name) && (
              <button type="button" className="btn btn-ghost btn-sm fb-suggest" onClick={() => setSlug(slugFromName(name))}>
                {t('forms.builder.useSlug', { slug: slugFromName(name) })}
              </button>
            )}
            <span className="ui-help">{t('forms.builder.slugExplain')}</span>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('consent')}>
              {t('forms.builder.consentText')}
            </label>
            <textarea
              id={fid('consent')}
              className="textarea"
              rows={2}
              value={settings.consentText}
              onChange={(e) => setS('consentText', e.target.value)}
              placeholder={t('forms.builder.consentPlaceholder')}
              disabled={!canEdit}
            />
          </div>
          <label className="ui-check">
            <input
              type="checkbox"
              checked={settings.consentRequired}
              onChange={(e) => setS('consentRequired', e.target.checked)}
              disabled={!canEdit || !settings.consentText}
            />
            {t('forms.builder.consentRequired')}
          </label>
        </AdvancedSection>
      </TabPanel>

      <TabPanel idBase={idBase} tab="after" active={tab} className="fb-panel">
        <fieldset className="fb-radios">
          <legend className="label">{t('forms.builder.successMode')}</legend>
          {(['message', 'redirect'] as const).map((mode) => (
            <label key={mode} className="fb-radio">
              <input
                type="radio"
                name={fid('success')}
                value={mode}
                checked={settings.successMode === mode}
                onChange={() => setS('successMode', mode)}
                disabled={!canEdit}
              />
              {mode === 'message' ? t('forms.builder.showMessage') : t('forms.builder.redirect')}
            </label>
          ))}
        </fieldset>
        {settings.successMode === 'redirect' ? (
          <div className="ui-field">
            <label className="label" htmlFor={fid('redirect')}>
              {t('forms.builder.redirectUrl')}
            </label>
            <input
              id={fid('redirect')}
              className="input"
              type="url"
              value={settings.redirectUrl}
              onChange={(e) => setS('redirectUrl', e.target.value)}
              placeholder="https://"
              aria-invalid={error?.tab === 'after' || undefined}
              disabled={!canEdit}
            />
          </div>
        ) : (
          <div className="ui-field">
            <label className="label" htmlFor={fid('thanks')}>
              {t('forms.builder.successMessage')}
            </label>
            <textarea
              id={fid('thanks')}
              className="textarea"
              rows={3}
              value={settings.successMessage}
              onChange={(e) => setS('successMessage', e.target.value)}
              disabled={!canEdit}
            />
          </div>
        )}
      </TabPanel>

      <TabPanel idBase={idBase} tab="crm" active={tab} className="fb-panel">
        <div className="ui-fields-2 fb-meta">
          <div className="ui-field">
            <label className="label" htmlFor={fid('name')}>
              {t('forms.builder.internalName')}
            </label>
            <input
              id={fid('name')}
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                dirty();
              }}
              disabled={!canEdit}
            />
            <span className="ui-help">{t('forms.builder.internalNameHint')}</span>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('status')}>
              {t('forms.builder.status')}
            </label>
            <select
              id={fid('status')}
              className="select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as FormStatus);
                dirty();
              }}
              disabled={!canEdit}
            >
              {(['active', 'paused', 'archived'] as const).map((st) => (
                <option key={st} value={st}>
                  {t(`forms.status.${st}`)}
                </option>
              ))}
            </select>
            <span className="ui-help">{t('forms.builder.statusHint')}</span>
          </div>
        </div>
        <p className="ui-help">{t('forms.builder.crmDesc')}</p>
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor={fid('owner')}>
              {t('filters.field.owner')}
            </label>
            <select id={fid('owner')} className="select" value={settings.ownerId} onChange={(e) => setS('ownerId', e.target.value)} disabled={!canEdit}>
              <option value="">{t('forms.builder.ownerAuto')}</option>
              {props.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('source')}>
              {t('filters.field.source')}
            </label>
            <select id={fid('source')} className="select" value={settings.source} onChange={(e) => setS('source', e.target.value)} disabled={!canEdit}>
              {SOURCES.map((v) => (
                <option key={v} value={v}>
                  {t(`enums.source.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('lifecycle')}>
              {t('filters.field.lifecycle')}
            </label>
            <select
              id={fid('lifecycle')}
              className="select"
              value={settings.lifecycleStage}
              onChange={(e) => setS('lifecycleStage', e.target.value)}
              disabled={!canEdit}
            >
              <option value="">{t('forms.builder.keepAsIs')}</option>
              {LIFECYCLE_STAGES.map((v) => (
                <option key={v} value={v}>
                  {t(`enums.lifecycle.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('lead')}>
              {t('filters.field.leadStatus')}
            </label>
            <select id={fid('lead')} className="select" value={settings.leadStatus} onChange={(e) => setS('leadStatus', e.target.value)} disabled={!canEdit}>
              <option value="">{t('forms.builder.keepAsIs')}</option>
              {LEAD_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`enums.leadStatus.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('list')}>
              {t('forms.builder.list')}
            </label>
            <select
              id={fid('list')}
              className="select"
              value={settings.listId}
              onChange={(e) => setS('listId', e.target.value)}
              aria-invalid={error?.tab === 'crm' || undefined}
              disabled={!canEdit}
            >
              <option value="">{t('forms.builder.noneOption')}</option>
              {props.lists.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={fid('seq')}>
              {t('forms.builder.sequence')}
            </label>
            <select id={fid('seq')} className="select" value={settings.sequenceId} onChange={(e) => setS('sequenceId', e.target.value)} disabled={!canEdit}>
              <option value="">{t('forms.builder.noneOption')}</option>
              {props.sequences.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="fb-group" data-testid="form-owner-rules">
          <h3 className="fb-group-title">{t('forms.builder.ownerRules')}</h3>
          <p className="ui-help">{t('forms.builder.ownerRulesHint')}</p>
          {settings.ownerRules.map((r, ri) => (
            <div key={ri} className="fb-rule">
              <select
                className="select"
                aria-label={t('forms.builder.ruleField')}
                value={r.field}
                onChange={(e) => setS('ownerRules', settings.ownerRules.map((x, xi) => (xi === ri ? { ...x, field: e.target.value } : x)))}
                disabled={!canEdit}
              >
                {fields
                  .filter((o) => o.type !== 'step')
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label || o.id}
                    </option>
                  ))}
              </select>
              <span className="fb-rule-eq">=</span>
              <input
                className="input"
                aria-label={t('forms.builder.ruleValue')}
                value={r.value}
                onChange={(e) => setS('ownerRules', settings.ownerRules.map((x, xi) => (xi === ri ? { ...x, value: e.target.value } : x)))}
                disabled={!canEdit}
              />
              <span className="fb-rule-eq">→</span>
              <select
                className="select"
                aria-label={t('filters.field.owner')}
                value={r.ownerId}
                onChange={(e) => setS('ownerRules', settings.ownerRules.map((x, xi) => (xi === ri ? { ...x, ownerId: e.target.value } : x)))}
                disabled={!canEdit}
              >
                {props.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setS('ownerRules', settings.ownerRules.filter((_, xi) => xi !== ri))}
                disabled={!canEdit}
                aria-label={t('forms.builder.removeRule')}
              >
                {t('common.delete')}
              </button>
            </div>
          ))}
          {canEdit && props.owners.length > 0 && (
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setS('ownerRules', [
                    ...settings.ownerRules,
                    { field: fields.find((f) => f.type === 'select')?.id ?? fields[0]?.id ?? '', value: '', ownerId: props.owners[0].id },
                  ])
                }
              >
                {t('forms.builder.addRule')}
              </button>
            </div>
          )}
        </div>

        <div className="fb-group" data-testid="form-create-deal">
          <h3 className="fb-group-title">{t('forms.builder.dealTitle')}</h3>
          <label className="ui-check">
            <input
              type="checkbox"
              checked={settings.createDeal}
              onChange={(e) => {
                const on = e.target.checked;
                const first = props.pipelines?.[0];
                setSettings((prev) => ({
                  ...prev,
                  createDeal: on,
                  dealPipelineId: prev.dealPipelineId || (on ? (first?.id ?? '') : ''),
                  dealStageId: prev.dealStageId || (on ? (first?.stages[0]?.id ?? '') : ''),
                }));
                dirty();
              }}
              disabled={!canEdit || !props.pipelines?.length}
            />
            {t('forms.builder.createDeal')}
          </label>
          {settings.createDeal && (
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={fid('deal-pipe')}>
                  {t('forms.builder.dealPipeline')}
                </label>
                <select
                  id={fid('deal-pipe')}
                  className="select"
                  value={settings.dealPipelineId}
                  onChange={(e) => {
                    const pipe = props.pipelines?.find((x) => x.id === e.target.value);
                    setSettings((prev) => ({ ...prev, dealPipelineId: e.target.value, dealStageId: pipe?.stages[0]?.id ?? '' }));
                    dirty();
                  }}
                  disabled={!canEdit}
                >
                  {(props.pipelines ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={fid('deal-stage')}>
                  {t('forms.builder.dealStage')}
                </label>
                <select
                  id={fid('deal-stage')}
                  className="select"
                  value={settings.dealStageId}
                  onChange={(e) => setS('dealStageId', e.target.value)}
                  aria-invalid={error?.tab === 'crm' || undefined}
                  disabled={!canEdit}
                >
                  {(props.pipelines?.find((x) => x.id === settings.dealPipelineId)?.stages ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={fid('deal-name')}>
                  {t('forms.builder.dealName')}
                </label>
                <input
                  id={fid('deal-name')}
                  className="input"
                  value={settings.dealName}
                  onChange={(e) => setS('dealName', e.target.value)}
                  disabled={!canEdit}
                />
                <span className="ui-help">{t('forms.builder.dealNameHint')}</span>
              </div>
            </div>
          )}
        </div>

        {props.tags.length > 0 && (
          <fieldset className="fb-tags">
            <legend className="label">{t('forms.builder.tags')}</legend>
            {props.tags.map((tag) => (
              <label key={tag.id} className="ui-check">
                <input
                  type="checkbox"
                  checked={settings.tagIds.includes(tag.id)}
                  onChange={(e) =>
                    setS('tagIds', e.target.checked ? [...settings.tagIds, tag.id] : settings.tagIds.filter((x) => x !== tag.id))
                  }
                  disabled={!canEdit}
                />
                {tag.label}
              </label>
            ))}
          </fieldset>
        )}

        <div className="fb-group">
          <h3 className="fb-group-title">{t('forms.builder.notify')}</h3>
          <label className="ui-check">
            <input type="checkbox" checked={settings.notifyOwner} onChange={(e) => setS('notifyOwner', e.target.checked)} disabled={!canEdit} />
            {t('forms.builder.notifyOwner')}
          </label>
          <div className="ui-field">
            <label className="label" htmlFor={fid('emails')}>
              {t('forms.builder.notifyEmails')}
            </label>
            <input
              id={fid('emails')}
              className="input"
              value={emailsText}
              onChange={(e) => {
                setEmailsText(e.target.value);
                dirty();
              }}
              placeholder="ventas@empresa.com"
              disabled={!canEdit}
            />
          </div>
        </div>

        <AdvancedSection storageKey="crm.form.crm" hint={t('forms.builder.crmAdvancedHint')}>
          <label className="ui-check">
            <input
              type="checkbox"
              checked={settings.updateExisting}
              onChange={(e) => setS('updateExisting', e.target.checked)}
              disabled={!canEdit}
            />
            {t('forms.builder.dedupe')}
          </label>
          <div className="ui-field fb-narrow">
            <label className="label" htmlFor={fid('min')}>
              {t('forms.builder.minSeconds')}
            </label>
            <input
              id={fid('min')}
              className="input data"
              type="number"
              min={0}
              max={60}
              value={settings.minSubmitSeconds}
              onChange={(e) => setS('minSubmitSeconds', Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
              disabled={!canEdit}
            />
            <span className="ui-help">{t('forms.builder.spamDesc')}</span>
          </div>
          <label className="ui-check">
            <input
              type="checkbox"
              checked={settings.captcha}
              onChange={(e) => setS('captcha', e.target.checked)}
              disabled={!canEdit || (!props.captchaAvailable && !settings.captcha)}
              data-testid="form-captcha-toggle"
            />
            {t('forms.builder.captcha')}
          </label>
          <span className="ui-help">{props.captchaAvailable ? t('forms.builder.captchaHint') : t('forms.builder.captchaMissing')}</span>
        </AdvancedSection>
      </TabPanel>

      <div className="crm-savebar">
        <p
          className="ui-section-note"
          role="status"
          aria-live="polite"
          data-tone={error ? 'error' : state === 'saved' ? 'ok' : undefined}
        >
          {canEdit ? statusNote : t('forms.builder.readOnly')}
        </p>
        {canEdit && (
          <span className="crm-savebar-actions">
            <span className="crm-savebar-secondary">{secondaryActions}</span>
            <button type="submit" className="btn btn-primary btn-sm" aria-busy={busy || undefined} data-testid="form-save">
              {t('forms.builder.saveForm')}
            </button>
          </span>
        )}
      </div>
      {canEdit && <div className="crm-savebar-more">{secondaryActions}</div>}
    </form>
  );
}
