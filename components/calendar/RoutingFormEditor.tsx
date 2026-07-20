'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { RoutingFormWithChildren, RoutingFieldWithOptions } from '@/lib/calendar-routing';
import type { CalendarRoutingRuleRow } from '@/lib/db';

interface EventTypeOption {
  id: string;
  title: string;
  slug: string;
}

interface RoutingFormEditorProps {
  initial?: RoutingFormWithChildren | null;
  eventTypes: EventTypeOption[];
  locale: string;
}

type FieldType = 'text' | 'select' | 'boolean';
type RuleOperator = 'is' | 'is_not' | 'contains' | 'truthy';

const OPERATORS: RuleOperator[] = ['is', 'is_not', 'contains', 'truthy'];
const ERROR_CODES = ['invalid_slug', 'slug_taken', 'invalid_input', 'generic'] as const;

const OP_LABEL_KEY: Record<RuleOperator, 'opIs' | 'opIsNot' | 'opContains' | 'opTruthy'> = {
  is: 'opIs',
  is_not: 'opIsNot',
  contains: 'opContains',
  truthy: 'opTruthy',
};

const emptyNewField = () => ({
  label: '',
  name: '',
  type: 'text' as FieldType,
  optionsText: '',
  required: false,
});

export default function RoutingFormEditor({ initial, eventTypes, locale }: RoutingFormEditorProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [values, setValues] = useState({
    slug: initial?.slug ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    active: initial ? initial.active === 1 : true,
    defaultEventTypeId: initial?.default_event_type_id ?? '',
  });
  const [fields, setFields] = useState<RoutingFieldWithOptions[]>(initial?.fields ?? []);
  const [rules, setRules] = useState<CalendarRoutingRuleRow[]>(initial?.rules ?? []);
  const [newField, setNewField] = useState(emptyNewField());
  const [newRule, setNewRule] = useState({
    fieldId: '',
    operator: 'is' as RuleOperator,
    value: '',
    eventTypeId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function showError(code: string) {
    setError(
      (ERROR_CODES as readonly string[]).includes(code) ? t(`errors.${code}`) : t('errors.generic'),
    );
  }

  async function onSubmitBasics(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      slug: values.slug,
      title: values.title,
      description: values.description || undefined,
      active: values.active,
      defaultEventTypeId: values.defaultEventTypeId || null,
    };

    const url = initial ? `/api/calendar/routing/${initial.id}` : '/api/calendar/routing';
    const method = initial ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (res && (res.status === 200 || res.status === 201)) {
      const data = (await res.json()) as { id: string };
      if (!initial) {
        // Recién creado: a la pantalla de edición para sumar preguntas y reglas.
        router.push(`/app/calendar/routing/${data.id}`);
        return;
      }
      setBusy(false);
      router.refresh();
      return;
    }

    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    showError(data?.error ?? 'generic');
    setBusy(false);
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    if (!initial) return;
    setBusy(true);
    setError(null);
    const name = newField.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_');
    const options =
      newField.type === 'select'
        ? newField.optionsText
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    const res = await fetch(`/api/calendar/routing/${initial.id}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        label: newField.label.trim(),
        type: newField.type,
        options,
        required: newField.required,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      const field = (await res.json()) as RoutingFieldWithOptions;
      setFields((prev) => [...prev, field]);
      setNewField(emptyNewField());
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    showError(data?.error ?? 'generic');
  }

  async function removeField(fieldId: string) {
    if (!initial) return;
    const res = await fetch(`/api/calendar/routing/${initial.id}/fields/${fieldId}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (res && res.status === 204) {
      setFields((prev) => prev.filter((f) => f.id !== fieldId));
      // Las reglas que apuntaban al field caen en cascada en el server.
      setRules((prev) => prev.filter((r) => r.field_id !== fieldId));
    }
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!initial || !newRule.fieldId || !newRule.eventTypeId) return;
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
      setNewRule({ fieldId: '', operator: 'is', value: '', eventTypeId: '' });
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    showError(data?.error ?? 'generic');
  }

  async function removeRule(ruleId: string) {
    if (!initial) return;
    const res = await fetch(`/api/calendar/routing/${initial.id}/rules/${ruleId}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (res && res.status === 204) {
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    }
  }

  async function copyPublicLink() {
    const url = `${window.location.origin}/${locale}/r/${values.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sin clipboard API: no se copia */
    }
  }

  function fieldLabel(fieldId: string): string {
    return fields.find((f) => f.id === fieldId)?.label ?? '—';
  }

  function eventTypeTitle(id: string): string {
    return eventTypes.find((et) => et.id === id)?.title ?? '—';
  }

  const ruleField = fields.find((f) => f.id === newRule.fieldId);

  return (
    <div className="calendar-form">
      <form className="calendar-form" onSubmit={onSubmitBasics}>
        <div className="form-grid">
          <label className="field">
            <span className="prop-label">{t('form.title')}</span>
            <input
              className="input"
              value={values.title}
              onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span className="prop-label">{t('form.slug')}</span>
            <input
              className="input mono"
              value={values.slug}
              onChange={(e) => setValues((v) => ({ ...v, slug: e.target.value }))}
              pattern="^[a-z0-9-]+$"
              required
              placeholder="sales-or-support"
            />
          </label>
        </div>

        <label className="field">
          <span className="prop-label">{t('form.description')}</span>
          <textarea
            className="input textarea"
            rows={3}
            value={values.description}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
          />
        </label>

        <div className="form-grid">
          <label className="field">
            <span className="prop-label">{t('routing.defaultEventType')}</span>
            <select
              className="select"
              value={values.defaultEventTypeId}
              onChange={(e) => setValues((v) => ({ ...v, defaultEventTypeId: e.target.value }))}
            >
              <option value="">{t('routing.noDefault')}</option>
              {eventTypes.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
            />
            <span className="prop-label">{t('form.active')}</span>
          </label>
        </div>

        {initial && (
          <div className="field">
            <span className="prop-label">{t('routing.publicLink')}</span>
            <div className="routing-link-row">
              <span className="mono muted">/{locale}/r/{values.slug}</span>
              <button type="button" className="btn btn-ghost btn-small" onClick={copyPublicLink}>
                {copied ? t('routing.copied') : t('routing.copy')}
              </button>
            </div>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="btn btn-solid" disabled={busy}>
            {busy ? t('common.saving') : initial ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>

      {initial && (
        <>
          <section className="panel fields-panel">
            <p className="section-label">{t('routing.fields')}</p>
            {fields.length === 0 ? (
              <p className="muted">{t('routing.noFields')}</p>
            ) : (
              <div className="custom-fields">
                {fields.map((f) => (
                  <div key={f.id} className="routing-field-row">
                    <span className="routing-field-label">{f.label}</span>
                    <span className="mono calendar-event-slug">{f.name}</span>
                    <span className="badge">{t(`routing.fieldType${f.type === 'select' ? 'Select' : f.type === 'boolean' ? 'Boolean' : 'Text'}`)}</span>
                    {f.required === 1 && <span className="badge">{t('form.fieldRequired')}</span>}
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => removeField(f.id)}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form className="routing-add-form" onSubmit={addField}>
              <input
                className="input"
                placeholder={t('form.fieldLabel')}
                value={newField.label}
                onChange={(e) => setNewField((v) => ({ ...v, label: e.target.value }))}
                required
              />
              <input
                className="input mono"
                placeholder={t('form.fieldName')}
                value={newField.name}
                onChange={(e) => setNewField((v) => ({ ...v, name: e.target.value }))}
                required
              />
              <select
                className="select"
                value={newField.type}
                onChange={(e) => setNewField((v) => ({ ...v, type: e.target.value as FieldType }))}
              >
                <option value="text">{t('routing.fieldTypeText')}</option>
                <option value="select">{t('routing.fieldTypeSelect')}</option>
                <option value="boolean">{t('routing.fieldTypeBoolean')}</option>
              </select>
              {newField.type === 'select' && (
                <input
                  className="input"
                  placeholder={t('routing.fieldOptions')}
                  value={newField.optionsText}
                  onChange={(e) => setNewField((v) => ({ ...v, optionsText: e.target.value }))}
                  required
                />
              )}
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={newField.required}
                  onChange={(e) => setNewField((v) => ({ ...v, required: e.target.checked }))}
                />
                <span>{t('form.fieldRequired')}</span>
              </label>
              <button type="submit" className="btn btn-small" disabled={busy}>
                {t('routing.addField')}
              </button>
            </form>
          </section>

          <section className="panel rules-panel">
            <p className="section-label">{t('routing.rules')}</p>
            <p className="muted hosts-help">{t('routing.rulesHelp')}</p>
            {rules.length === 0 ? (
              <p className="muted">{t('routing.noRules')}</p>
            ) : (
              <div className="custom-fields">
                {rules.map((r) => (
                  <div key={r.id} className="routing-rule-row">
                    <span className="routing-rule-text">
                      {fieldLabel(r.field_id)}
                      {' '}
                      <span className="mono">{t(`routing.${OP_LABEL_KEY[r.operator]}`)}</span>
                      {r.operator !== 'truthy' && r.value && (
                        <>
                          {' '}
                          <span className="mono">“{r.value}”</span>
                        </>
                      )}
                      {' → '}
                      {eventTypeTitle(r.event_type_id)}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => removeRule(r.id)}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {fields.length > 0 && eventTypes.length > 0 && (
              <form className="routing-add-form" onSubmit={addRule}>
                <select
                  className="select"
                  value={newRule.fieldId}
                  onChange={(e) => setNewRule((v) => ({ ...v, fieldId: e.target.value, value: '' }))}
                  required
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
                <select
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
                {newRule.operator !== 'truthy' &&
                  (ruleField?.type === 'select' ? (
                    <select
                      className="select"
                      value={newRule.value}
                      onChange={(e) => setNewRule((v) => ({ ...v, value: e.target.value }))}
                      required
                    >
                      <option value="" disabled>
                        {t('routing.ruleValue')}
                      </option>
                      {ruleField.optionsParsed.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : ruleField?.type === 'boolean' ? (
                    <select
                      className="select"
                      value={newRule.value}
                      onChange={(e) => setNewRule((v) => ({ ...v, value: e.target.value }))}
                      required
                    >
                      <option value="" disabled>
                        {t('routing.ruleValue')}
                      </option>
                      <option value="true">{t('routing.valueTrue')}</option>
                      <option value="false">{t('routing.valueFalse')}</option>
                    </select>
                  ) : (
                    <input
                      className="input"
                      placeholder={t('routing.ruleValue')}
                      value={newRule.value}
                      onChange={(e) => setNewRule((v) => ({ ...v, value: e.target.value }))}
                      required
                    />
                  ))}
                <select
                  className="select"
                  value={newRule.eventTypeId}
                  onChange={(e) => setNewRule((v) => ({ ...v, eventTypeId: e.target.value }))}
                  required
                >
                  <option value="" disabled>
                    {t('routing.ruleTarget')}
                  </option>
                  {eventTypes.map((et) => (
                    <option key={et.id} value={et.id}>
                      {et.title}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-small" disabled={busy}>
                  {t('routing.addRule')}
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
