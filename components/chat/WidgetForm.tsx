'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ChatWidgetRow } from '@/lib/db';
import type { OfficeHoursConfig, OfficeHoursDay } from '@/lib/chat-data';

export interface WidgetFormField {
  id: string;
  name: string;
  required: boolean;
  type: 'text' | 'email' | 'number';
}

interface WidgetFormProps {
  initial?: ChatWidgetRow | null;
  /** Si el servidor tiene AI configurada (lib/ai.ts aiEnabled). */
  aiAvailable?: boolean;
}

function emptyField(): WidgetFormField {
  return { id: crypto.randomUUID(), name: '', required: false, type: 'text' };
}

function parseFields(initial: ChatWidgetRow | null | undefined): WidgetFormField[] {
  if (!initial) return [];
  try {
    const list = JSON.parse(initial.fields) as unknown[];
    if (!Array.isArray(list)) return [];
    return list
      .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
      .map((f) => ({
        id: typeof f.id === 'string' ? f.id : crypto.randomUUID(),
        name: typeof f.name === 'string' ? f.name : '',
        required: f.required === true,
        type: ['text', 'email', 'number'].includes(typeof f.type === 'string' ? f.type : '')
          ? (f.type as 'text' | 'email' | 'number')
          : 'text',
      }));
  } catch {
    return [];
  }
}

function defaultDays(): OfficeHoursDay[] {
  // Índice 0 = domingo … 6 = sábado (Date.getDay). Lun–vie 9–18 por defecto.
  return Array.from({ length: 7 }, (_, i) => ({
    enabled: i >= 1 && i <= 5,
    start: '09:00',
    end: '18:00',
  }));
}

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function parseOfficeHours(initial: ChatWidgetRow | null | undefined): {
  enabled: boolean;
  timezone: string;
  days: OfficeHoursDay[];
} {
  const fallback = { enabled: false, timezone: guessTimezone(), days: defaultDays() };
  if (!initial?.office_hours) return fallback;
  try {
    const parsed = JSON.parse(initial.office_hours) as Partial<OfficeHoursConfig>;
    if (typeof parsed.timezone !== 'string' || !Array.isArray(parsed.days) || parsed.days.length !== 7) {
      return fallback;
    }
    return {
      enabled: true,
      timezone: parsed.timezone,
      days: parsed.days.map((d) => ({
        enabled: d?.enabled === true,
        start: typeof d?.start === 'string' ? d.start : '09:00',
        end: typeof d?.end === 'string' ? d.end : '18:00',
      })),
    };
  } catch {
    return fallback;
  }
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export default function WidgetForm({ initial, aiAvailable = false }: WidgetFormProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState({
    name: initial?.name ?? '',
    color: initial?.color ?? '#000000',
    position: initial?.position ?? 'bottom-right',
    welcomeMessage: initial?.welcome_message ?? '',
    botEnabled: initial?.bot_enabled === 1,
    botGreeting: initial?.bot_greeting ?? '',
    botSource: initial?.bot_source ?? 'canned',
  });
  const [fields, setFields] = useState<WidgetFormField[]>(parseFields(initial));
  const [office, setOffice] = useState(parseOfficeHours(initial));

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);

  function set<K extends keyof typeof values>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value =
        e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
      setValues((prev) => ({ ...prev, [key]: value }));
    };
  }

  function updateField(index: number, patch: Partial<WidgetFormField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function addField() {
    setFields((prev) => [...prev, emptyField()]);
  }

  function updateDay(index: number, patch: Partial<OfficeHoursDay>) {
    setOffice((prev) => ({
      ...prev,
      days: prev.days.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      name: values.name.trim(),
      color: values.color,
      position: values.position as 'bottom-right' | 'bottom-left',
      welcomeMessage: values.welcomeMessage.trim() || undefined,
      fields: fields
        .filter((f) => f.name.trim())
        .map((f) => ({ id: f.id, name: f.name.trim(), required: f.required, type: f.type })),
      botEnabled: values.botEnabled,
      botGreeting: values.botGreeting.trim() || undefined,
      botSource: values.botSource as 'canned' | 'docs' | 'ai' | 'agent',
      officeHours: office.enabled
        ? { timezone: office.timezone.trim() || 'UTC', days: office.days }
        : null,
    };

    const url = initial ? `/api/chat/widgets/${initial.id}` : '/api/chat/widgets';
    const method = initial ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (res && (res.status === 200 || res.status === 201)) {
      const data = (await res.json()) as { id: string };
      router.push(`/app/chat/widgets/${data.id}`);
      return;
    }

    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t(`errors.${code}` as const) || t('errors.generic'));
    setBusy(false);
  }

  return (
    <form className="chat-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('widgetForm.name')}</span>
          <input className="input" value={values.name} onChange={set('name')} required />
        </label>
        <label className="field">
          <span className="prop-label">{t('widgetForm.color')}</span>
          <input className="input" type="color" value={values.color} onChange={set('color')} />
        </label>
      </div>

      <label className="field">
        <span className="prop-label">{t('widgetForm.position')}</span>
        <select className="select" value={values.position} onChange={set('position')}>
          <option value="bottom-right">{t('widgetForm.positionBottomRight')}</option>
          <option value="bottom-left">{t('widgetForm.positionBottomLeft')}</option>
        </select>
      </label>

      <label className="field">
        <span className="prop-label">{t('widgetForm.welcomeMessage')}</span>
        <textarea
          className="input textarea"
          rows={3}
          value={values.welcomeMessage}
          onChange={set('welcomeMessage')}
        />
      </label>

      <section className="panel fields-panel">
        <div className="panel-head">
          <p className="section-label">{t('widgetForm.fields')}</p>
          <button type="button" className="btn btn-small" onClick={addField}>
            {t('widgetForm.addField')}
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="muted">{t('common.empty')}</p>
        ) : (
          <div className="custom-fields">
            {fields.map((f, i) => (
              <div key={f.id} className="custom-field-row">
                <input
                  className="input"
                  placeholder={t('widgetForm.fieldName')}
                  value={f.name}
                  onChange={(e) => updateField(i, { name: e.target.value })}
                />
                <select
                  className="select"
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as WidgetFormField['type'] })}
                >
                  <option value="text">{t('widgetForm.fieldTypeText')}</option>
                  <option value="email">Email</option>
                  <option value="number">{t('widgetForm.fieldTypeNumber')}</option>
                </select>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  <span>{t('widgetForm.fieldRequired')}</span>
                </label>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => removeField(i)}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel fields-panel">
        <div className="panel-head">
          <p className="section-label">{t('bot.title')}</p>
          <label className="checkbox-field">
            <input type="checkbox" checked={values.botEnabled} onChange={set('botEnabled')} />
            <span>{t('bot.enabled')}</span>
          </label>
        </div>
        {values.botEnabled ? (
          <div className="chat-bot-config">
            <label className="field">
              <span className="prop-label">{t('bot.greeting')}</span>
              <textarea
                className="input textarea"
                rows={2}
                placeholder={t('bot.greetingPlaceholder')}
                value={values.botGreeting}
                onChange={set('botGreeting')}
              />
            </label>
            <label className="field">
              <span className="prop-label">{t('bot.source')}</span>
              <select className="select" value={values.botSource} onChange={set('botSource')}>
                <option value="canned">{t('bot.sourceCanned')}</option>
                <option value="docs">{t('bot.sourceDocs')}</option>
                <option value="ai">{t('bot.sourceAi')}</option>
                {initial?.bot_source === 'agent' && <option value="agent">{t('bot.sourceAgent')}</option>}
              </select>
            </label>
            {values.botSource === 'ai' && !aiAvailable && (
              <p className="muted chat-bot-hint">{t('bot.aiNotConfigured')}</p>
            )}
            <p className="muted chat-bot-hint">
              {t(values.botSource === 'agent' ? 'bot.hintAgent' : values.botSource === 'ai' ? 'bot.hintAi' : 'bot.hint')}
            </p>
          </div>
        ) : (
          <p className="muted">{t('bot.disabled')}</p>
        )}
      </section>

      <section className="panel fields-panel">
        <div className="panel-head">
          <p className="section-label">{t('officeHours.title')}</p>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={office.enabled}
              onChange={(e) => setOffice((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            <span>{t('officeHours.enabled')}</span>
          </label>
        </div>
        {office.enabled ? (
          <div className="chat-office-config">
            <label className="field">
              <span className="prop-label">{t('officeHours.timezone')}</span>
              <input
                className="input"
                list="zs-timezones"
                value={office.timezone}
                onChange={(e) => setOffice((prev) => ({ ...prev, timezone: e.target.value }))}
              />
              <datalist id="zs-timezones">
                {timezones.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </label>
            <div className="chat-office-days">
              {office.days.map((d, i) => (
                <div key={i} className="chat-office-day">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => updateDay(i, { enabled: e.target.checked })}
                    />
                    <span>{t(`widgetForm.days.${DAY_KEYS[i]}`)}</span>
                  </label>
                  <input
                    type="time"
                    className="input"
                    value={d.start}
                    disabled={!d.enabled}
                    onChange={(e) => updateDay(i, { start: e.target.value })}
                  />
                  <span className="muted">–</span>
                  <input
                    type="time"
                    className="input"
                    value={d.end}
                    disabled={!d.enabled}
                    onChange={(e) => updateDay(i, { end: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <p className="muted chat-bot-hint">{t('officeHours.hint')}</p>
          </div>
        ) : (
          <p className="muted">{t('officeHours.disabled')}</p>
        )}
      </section>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-solid" disabled={busy}>
          {busy ? t('common.loading') : initial ? t('widgetForm.save') : t('widgetForm.create')}
        </button>
      </div>
    </form>
  );
}
