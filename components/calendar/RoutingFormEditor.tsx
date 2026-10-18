'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import type { RoutingFormWithChildren, RoutingFieldWithOptions } from '@/lib/calendar-routing';
import type { CalendarRoutingRuleRow } from '@/lib/db';
import CalIcon from './cal-icons';
import CalCopyButton from './CalCopyButton';
import { fieldKeyFromLabel } from './cal-utils';

interface EventTypeOption {
  id: string;
  title: string;
  slug: string;
}

interface RoutingFormEditorProps {
  initial: RoutingFormWithChildren;
  eventTypes: EventTypeOption[];
  /** URL pública completa sin el slug: https://…/es/r/<handle>/ */
  publicBase: string;
}

type FieldType = 'text' | 'select' | 'boolean';
type RuleOperator = 'is' | 'is_not' | 'contains' | 'truthy';
const OPERATORS: RuleOperator[] = ['is', 'is_not', 'contains', 'truthy'];
const OP_LABEL_KEY: Record<RuleOperator, 'opIs' | 'opIsNot' | 'opContains' | 'opTruthy'> = {
  is: 'opIs',
  is_not: 'opIsNot',
  contains: 'opContains',
  truthy: 'opTruthy',
};
const STEPS = ['questions', 'rules', 'publish'] as const;
type Step = (typeof STEPS)[number];

const emptyField = () => ({ label: '', type: 'text' as FieldType, optionsText: '', required: true });
const emptyRule = () => ({ fieldId: '', operator: 'is' as RuleOperator, value: '', eventTypeId: '' });

/**
 * Editor de un routing form en tres paradas: Preguntas → Reglas → Publicar.
 * Preguntas y reglas se guardan al agregarlas o quitarlas; los datos del
 * formulario (nombre, URL, activo) tienen un solo Guardar en Publicar. La
 * clave técnica de cada pregunta sale de su etiqueta.
 */
export default function RoutingFormEditor({ initial, eventTypes, publicBase }: RoutingFormEditorProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const baseId = useId();
  const [step, setStep] = useState<Step>(initial.fields.length === 0 ? 'questions' : initial.rules.length === 0 ? 'rules' : 'publish');
  const [fields, setFields] = useState<RoutingFieldWithOptions[]>(initial.fields);
  const [rules, setRules] = useState<CalendarRoutingRuleRow[]>(initial.rules);
  const [defaultEventTypeId, setDefaultEventTypeId] = useState(initial.default_event_type_id ?? '');
  const [newField, setNewField] = useState(emptyField());
  const [newRule, setNewRule] = useState(emptyRule());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [slug, setSlug] = useState(initial.slug);
  const [savedSlug, setSavedSlug] = useState(initial.slug);
  const stepRefs = useRef<Record<Step, HTMLButtonElement | null>>({} as Record<Step, HTMLButtonElement | null>);

  async function code(res: Response | null): Promise<string> {
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const c = typeof data?.error === 'string' ? data.error : data?.error?.code;
    return c && t.has(`errors.${c}`) ? c : 'generic';
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    const label = newField.label.trim();
    if (!label) return;
    const options =
      newField.type === 'select'
        ? newField.optionsText
            .split(/[\n,]/)
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    if (newField.type === 'select' && (!options || options.length < 2)) {
      setError(t('routing.optionsRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/routing/${initial.id}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: fieldKeyFromLabel(label, fields.map((f) => f.name)),
        label,
        type: newField.type,
        options,
        required: newField.required,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      const field = (await res.json()) as RoutingFieldWithOptions;
      setFields((prev) => [...prev, field]);
      setNewField(emptyField());
      return;
    }
    setError(t(`errors.${await code(res)}`));
  }

  async function removeField(fieldId: string) {
    const res = await fetch(`/api/calendar/routing/${initial.id}/fields/${fieldId}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      setFields((prev) => prev.filter((f) => f.id !== fieldId));
      // Las reglas que apuntaban al field caen en cascada en el server.
      setRules((prev) => prev.filter((r) => r.field_id !== fieldId));
    } else setError(t('errors.generic'));
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newRule.fieldId || !newRule.eventTypeId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/routing/${initial.id}/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fieldId: newRule.fieldId,
        operator: newRule.operator,
        value: newRule.operator === 'truthy' ? '' : newRule.value.trim(),
        eventTypeId: newRule.eventTypeId,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      const rule = (await res.json()) as CalendarRoutingRuleRow;
      setRules((prev) => [...prev, rule]);
      setNewRule(emptyRule());
      return;
    }
    setError(t(`errors.${await code(res)}`));
  }

  async function removeRule(ruleId: string) {
    const res = await fetch(`/api/calendar/routing/${initial.id}/rules/${ruleId}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) setRules((prev) => prev.filter((r) => r.id !== ruleId));
    else setError(t('errors.generic'));
  }

  async function saveDefault(next: string) {
    setDefaultEventTypeId(next);
    setDefaultSaved(false);
    const res = await fetch(`/api/calendar/routing/${initial.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultEventTypeId: next || null }),
    }).catch(() => null);
    if (res && res.ok) setDefaultSaved(true);
    else setError(t('errors.generic'));
  }

  async function savePublish(fd: FormData) {
    const nextSlug = String(fd.get('slug') ?? '').trim();
    const res = await fetch(`/api/calendar/routing/${initial.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: String(fd.get('title') ?? '').trim(),
        description: String(fd.get('description') ?? '').trim(),
        slug: nextSlug,
        active: fd.get('active') === 'on',
      }),
    }).catch(() => null);
    if (res && res.ok) {
      setSavedSlug(nextSlug);
      router.refresh();
      return;
    }
    return t(`errors.${await code(res)}`);
  }

  const fieldLabel = (id: string) => fields.find((f) => f.id === id)?.label ?? '?';
  const eventTitle = (id: string) => eventTypes.find((et) => et.id === id)?.title ?? '?';
  const ruleField = fields.find((f) => f.id === newRule.fieldId);
  const publicUrl = `${publicBase}${savedSlug}`;
  const idFor = (k: string) => `${baseId}-${k}`;

  function onStepKey(e: KeyboardEvent<HTMLButtonElement>, from: Step) {
    const i = STEPS.indexOf(from);
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: STEPS.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const next = STEPS[(map[e.key] + STEPS.length) % STEPS.length];
    setStep(next);
    stepRefs.current[next]?.focus();
  }

  const stepMeta: Record<Step, { label: string; hint: string }> = {
    questions: { label: t('routing.stepQuestions'), hint: t('routing.nQuestions', { n: fields.length }) },
    rules: { label: t('routing.stepRules'), hint: t('routing.nRules', { n: rules.length }) },
    publish: { label: t('routing.stepPublish'), hint: initial.active ? t('routing.live') : t('routing.inactive') },
  };

  return (
    <div className="ui-page">
      <div className="cal-stepper" role="tablist" aria-label={t('routing.steps')}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            ref={(el) => {
              stepRefs.current[s] = el;
            }}
            type="button"
            role="tab"
            id={idFor(`tab-${s}`)}
            aria-selected={step === s}
            aria-controls={idFor(`panel-${s}`)}
            tabIndex={step === s ? 0 : -1}
            className="cal-step"
            data-done={STEPS.indexOf(step) > i || undefined}
            onClick={() => setStep(s)}
            onKeyDown={(e) => onStepKey(e, s)}
          >
            <span className="cal-step-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="cal-step-text">
              <span className="cal-step-label">{stepMeta[s].label}</span>
              <span className="cal-step-hint">{stepMeta[s].hint}</span>
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {/* ---------- Preguntas ---------- */}
      <div id={idFor('panel-questions')} role="tabpanel" aria-labelledby={idFor('tab-questions')} hidden={step !== 'questions'} className="cal-route-panel">
        <FormSection title={t('routing.fields')} description={t('routing.fieldsLead')}>
          {fields.length === 0 ? (
            <p className="cal-muted">{t('routing.noFields')}</p>
          ) : (
            <ol className="cal-route-list">
              {fields.map((f) => (
                <li key={f.id}>
                  <span className="cal-route-main">
                    <strong>{f.label}</strong>
                    <span className="cal-muted">
                      {t(`routing.fieldType${f.type === 'select' ? 'Select' : f.type === 'boolean' ? 'Boolean' : 'Text'}`)}
                      {f.type === 'select' && f.optionsParsed.length > 0 && `: ${f.optionsParsed.join(', ')}`}
                    </span>
                  </span>
                  {f.required === 1 && <span className="badge">{t('form.fieldRequired')}</span>}
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={t('routing.removeQuestion', { label: f.label })}
                    title={t('common.remove')}
                    onClick={() => removeField(f.id)}
                  >
                    <CalIcon name="trash" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <form className="cal-route-add" onSubmit={addField}>
            <div className="ui-field cal-route-grow">
              <label className="label" htmlFor={idFor('flabel')}>
                {t('routing.newQuestion')}
              </label>
              <input
                id={idFor('flabel')}
                className="input"
                value={newField.label}
                placeholder={t('routing.questionPlaceholder')}
                onChange={(e) => setNewField((v) => ({ ...v, label: e.target.value }))}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={idFor('ftype')}>
                {t('editor.answerType')}
              </label>
              <select
                id={idFor('ftype')}
                className="select"
                value={newField.type}
                onChange={(e) => setNewField((v) => ({ ...v, type: e.target.value as FieldType }))}
              >
                <option value="text">{t('routing.fieldTypeText')}</option>
                <option value="select">{t('routing.fieldTypeSelect')}</option>
                <option value="boolean">{t('routing.fieldTypeBoolean')}</option>
              </select>
            </div>
            {newField.type === 'select' && (
              <div className="ui-field cal-route-full">
                <label className="label" htmlFor={idFor('fopts')}>
                  {t('routing.fieldOptions')}
                </label>
                <input
                  id={idFor('fopts')}
                  className="input"
                  value={newField.optionsText}
                  placeholder={t('routing.optionsPlaceholder')}
                  onChange={(e) => setNewField((v) => ({ ...v, optionsText: e.target.value }))}
                />
              </div>
            )}
            <label className="ui-check cal-route-check">
              <input type="checkbox" checked={newField.required} onChange={(e) => setNewField((v) => ({ ...v, required: e.target.checked }))} />
              <span>{t('form.fieldRequired')}</span>
            </label>
            <button type="submit" className="btn" aria-busy={busy || undefined} disabled={!newField.label.trim()}>
              <CalIcon name="plus" />
              {t('routing.addField')}
            </button>
          </form>
          <p className="ui-help">{t('routing.prefillHint')}</p>
        </FormSection>
        <div className="cal-step-next">
          <button type="button" className="btn btn-primary" onClick={() => setStep('rules')} disabled={fields.length === 0}>
            {t('routing.nextRules')}
            <CalIcon name="next" />
          </button>
        </div>
      </div>

      {/* ---------- Reglas ---------- */}
      <div id={idFor('panel-rules')} role="tabpanel" aria-labelledby={idFor('tab-rules')} hidden={step !== 'rules'} className="cal-route-panel">
        {eventTypes.length === 0 ? (
          <EmptyState
            title={t('routing.noEventTypesTitle')}
            body={t('routing.noEventTypesBody')}
            action={{ label: t('eventTypes.newCta'), href: '/app/calendar/event-types?new=1' }}
          />
        ) : (
          <FormSection title={t('routing.rules')} description={t('routing.rulesHelp')}>
            {rules.length === 0 ? (
              <p className="cal-muted">{t('routing.noRules')}</p>
            ) : (
              <ol className="cal-route-list">
                {rules.map((r) => (
                  <li key={r.id}>
                    <span className="cal-route-main cal-rule-text">
                      <span className="cal-muted">{t('routing.if')}</span> <strong>{fieldLabel(r.field_id)}</strong>{' '}
                      {t(`routing.${OP_LABEL_KEY[r.operator]}`)}
                      {r.operator !== 'truthy' && r.value && (
                        <>
                          {' '}
                          <strong>{r.value}</strong>
                        </>
                      )}
                      <CalIcon name="next" />
                      <strong>{eventTitle(r.event_type_id)}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label={t('routing.removeRule')}
                      title={t('common.remove')}
                      onClick={() => removeRule(r.id)}
                    >
                      <CalIcon name="trash" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {fields.length === 0 ? (
              <p className="ui-help">{t('routing.rulesNeedQuestions')}</p>
            ) : (
              <form className="cal-route-add" onSubmit={addRule}>
                <div className="ui-field">
                  <label className="label" htmlFor={idFor('rfield')}>
                    {t('routing.if')}
                  </label>
                  <select
                    id={idFor('rfield')}
                    className="select"
                    value={newRule.fieldId}
                    onChange={(e) => setNewRule((v) => ({ ...v, fieldId: e.target.value, value: '' }))}
                  >
                    <option value="" disabled>
                      {t('routing.ruleField')}
                    </option>
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ui-field">
                  <label className="label" htmlFor={idFor('rop')}>
                    {t('routing.condition')}
                  </label>
                  <select
                    id={idFor('rop')}
                    className="select"
                    value={newRule.operator}
                    onChange={(e) => setNewRule((v) => ({ ...v, operator: e.target.value as RuleOperator }))}
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {t(`routing.${OP_LABEL_KEY[op]}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {newRule.operator !== 'truthy' && (
                  <div className="ui-field">
                    <label className="label" htmlFor={idFor('rval')}>
                      {t('routing.ruleValue')}
                    </label>
                    {ruleField?.type === 'select' || ruleField?.type === 'boolean' ? (
                      <select
                        id={idFor('rval')}
                        className="select"
                        value={newRule.value}
                        onChange={(e) => setNewRule((v) => ({ ...v, value: e.target.value }))}
                      >
                        <option value="" disabled>
                          {t('routing.choose')}
                        </option>
                        {ruleField.type === 'select' ? (
                          ruleField.optionsParsed.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="true">{t('routing.valueTrue')}</option>
                            <option value="false">{t('routing.valueFalse')}</option>
                          </>
                        )}
                      </select>
                    ) : (
                      <input id={idFor('rval')} className="input" value={newRule.value} onChange={(e) => setNewRule((v) => ({ ...v, value: e.target.value }))} />
                    )}
                  </div>
                )}
                <div className="ui-field">
                  <label className="label" htmlFor={idFor('rtarget')}>
                    {t('routing.ruleTarget')}
                  </label>
                  <select
                    id={idFor('rtarget')}
                    className="select"
                    value={newRule.eventTypeId}
                    onChange={(e) => setNewRule((v) => ({ ...v, eventTypeId: e.target.value }))}
                  >
                    <option value="" disabled>
                      {t('routing.choose')}
                    </option>
                    {eventTypes.map((et) => (
                      <option key={et.id} value={et.id}>
                        {et.title}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="btn"
                  aria-busy={busy || undefined}
                  disabled={!newRule.fieldId || !newRule.eventTypeId || (newRule.operator !== 'truthy' && !newRule.value.trim())}
                >
                  <CalIcon name="plus" />
                  {t('routing.addRule')}
                </button>
              </form>
            )}
            <div className="ui-field cal-route-default">
              <label className="label" htmlFor={idFor('default')}>
                {t('routing.defaultEventType')}
              </label>
              <select id={idFor('default')} className="select" value={defaultEventTypeId} onChange={(e) => void saveDefault(e.target.value)}>
                <option value="">{t('routing.noDefault')}</option>
                {eventTypes.map((et) => (
                  <option key={et.id} value={et.id}>
                    {et.title}
                  </option>
                ))}
              </select>
              <p className="ui-help" role="status">
                {defaultSaved ? t('editor.saved') : t('routing.defaultHelp')}
              </p>
            </div>
          </FormSection>
        )}
        <div className="cal-step-next">
          <button type="button" className="btn btn-ghost" onClick={() => setStep('questions')}>
            <CalIcon name="prev" />
            {t('routing.stepQuestions')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setStep('publish')}>
            {t('routing.nextPublish')}
            <CalIcon name="next" />
          </button>
        </div>
      </div>

      {/* ---------- Publicar ---------- */}
      <div id={idFor('panel-publish')} role="tabpanel" aria-labelledby={idFor('tab-publish')} hidden={step !== 'publish'} className="cal-route-panel">
        <FormSection title={t('routing.stepPublish')} description={t('routing.publishLead')} onSubmit={savePublish} submitLabel={t('editor.save')}>
          <div className="ui-field">
            <label className="label" htmlFor={idFor('title')}>
              {t('form.title')}
            </label>
            <input id={idFor('title')} name="title" className="input" defaultValue={initial.title} required maxLength={200} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={idFor('desc')}>
              {t('form.description')} <span className="ui-optional">{t('editor.optional')}</span>
            </label>
            <textarea id={idFor('desc')} name="description" className="textarea" rows={2} defaultValue={initial.description ?? ''} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={idFor('slug')}>
              {t('editor.link')}
            </label>
            <div className="ui-input-group">
              <span className="ui-addon">{publicBase.replace(/^https?:\/\/[^/]+/, '')}</span>
              <input
                id={idFor('slug')}
                name="slug"
                className="input data"
                value={slug}
                pattern="[a-z0-9\-]+"
                required
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              />
            </div>
            <p className="ui-help">{slug !== savedSlug ? t('editor.slugWarning') : t('routing.slugHelp')}</p>
          </div>
          <label className="ui-switch">
            <input type="checkbox" role="switch" name="active" defaultChecked={initial.active === 1} />
            <span>{t('routing.activeLabel')}</span>
          </label>
          <div className="cal-share-url">
            <span className="data">{publicUrl}</span>
            <CalCopyButton text={publicUrl} />
            <a className="btn btn-sm btn-ghost" href={publicUrl} target="_blank" rel="noreferrer">
              <CalIcon name="external" />
              {t('routing.openForm')}
            </a>
          </div>
        </FormSection>
      </div>
    </div>
  );
}
