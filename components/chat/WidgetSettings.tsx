'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ChatWidgetRow } from '@/lib/db';
import type { OfficeHoursDay } from '@/lib/chat-data';
import SettingsTabs from '@/components/ui/SettingsTabs';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import ColorField from './ColorField';
import EmbedCode from './EmbedCode';
import IdentityVerification from './IdentityVerification';
import ChatIcon from './icons';
import {
  buildWidgetPayload,
  emptyField,
  initialValues,
  parseFields,
  parseOfficeHours,
  widgetTab,
  type WidgetFormField,
  type WidgetFormValues,
} from './widget-form-model';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** Lunes primero en la grilla; el índice guardado sigue siendo Date.getDay. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface WidgetSettingsProps {
  widget: ChatWidgetRow;
  origin: string;
  aiAvailable: boolean;
  /** Conversaciones del widget (todas): se borran con él. */
  conversationCount: number;
  /** Ruta del centro de ayuda del workspace (/<locale>/h/<handle>), si hay handle. */
  helpCenterPath: string | null;
  /** Owner/admin: puede ver y cambiar el secreto de verificación de identidad. */
  canManageIdentity: boolean;
  identitySecret: string | null;
}

/**
 * Editor del widget en cuatro pestañas (Apariencia, Formulario previo, Bot,
 * Horario). Cada pestaña es un formulario con un solo Guardar que guarda el
 * widget entero; las opciones que el camino básico no necesita (fuente del
 * bot, zona horaria) quedan en Avanzado.
 */
export default function WidgetSettings({
  widget,
  origin,
  aiAvailable,
  conversationCount,
  helpCenterPath,
  canManageIdentity,
  identitySecret,
}: WidgetSettingsProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const search = useSearchParams();
  const tab = widgetTab(search?.get('tab'));
  const uid = useId();

  const [values, setValues] = useState<WidgetFormValues>(() => initialValues(widget));
  const [fields, setFields] = useState<WidgetFormField[]>(() => parseFields(widget.fields));
  const [office, setOffice] = useState(() => parseOfficeHours(widget.office_hours));
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRef = useRef<HTMLDialogElement>(null);

  // <dialog> del kit con showModal(): foco atrapado y Esc gratis.
  useEffect(() => {
    const d = confirmRef.current;
    if (!d) return;
    if (confirmOpen && !d.open) d.showModal();
    if (!confirmOpen && d.open) d.close();
  }, [confirmOpen]);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);

  function set<K extends keyof WidgetFormValues>(key: K, value: WidgetFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateField(index: number, patch: Partial<WidgetFormField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function updateDay(index: number, patch: Partial<OfficeHoursDay>) {
    setOffice((prev) => ({ ...prev, days: prev.days.map((d, i) => (i === index ? { ...d, ...patch } : d)) }));
  }

  async function save(): Promise<string | void> {
    if (!values.name.trim()) return t('errors.missing_name');
    const res = await fetch(`/api/chat/widgets/${widget.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildWidgetPayload(values, fields, office)),
    }).catch(() => null);
    if (res?.ok) {
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error;
    return code === 'missing_name' || code === 'invalid_input' ? t(`errors.${code}`) : t('errors.generic');
  }

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/chat/widgets/${widget.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      router.push('/app/chat/widgets');
      router.refresh();
      return;
    }
    setDeleting(false);
    setDeleteError(t('errors.generic'));
  }

  const tabs = [
    { key: 'look', label: t('widgetForm.tabs.look') },
    { key: 'form', label: t('widgetForm.tabs.form') },
    { key: 'bot', label: t('widgetForm.tabs.bot') },
    { key: 'hours', label: t('widgetForm.tabs.hours') },
  ];

  return (
    <SettingsTabs mode="query" param="tab" layout="top" items={tabs} label={t('widgetForm.tabsLabel')}>
      {tab === 'look' && (
        <>
          <EmbedCode widgetId={widget.id} origin={origin} />
          <IdentityVerification widgetId={widget.id} canManage={canManageIdentity} initialSecret={identitySecret} />
          <FormSection title={t('widgetForm.lookTitle')} description={t('widgetForm.lookSub')} onSubmit={save}>
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-name`}>
                {t('widgetForm.name')}
              </label>
              <input
                id={`${uid}-name`}
                className="input"
                value={values.name}
                maxLength={200}
                required
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="ui-field">
              <span className="label" id={`${uid}-color`}>
                {t('widgetForm.color')}
              </span>
              <ColorField labelId={`${uid}-color`} value={values.color} onChange={(c) => set('color', c)} />
            </div>
            <div className="ui-field">
              <span className="label" id={`${uid}-position`}>
                {t('widgetForm.position')}
              </span>
              {/* Control segmentado (como los rangos de Reportes). */}
              <div className="btn-group chat-segmented" role="radiogroup" aria-labelledby={`${uid}-position`}>
                {(['bottom-left', 'bottom-right'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    className="btn btn-sm"
                    aria-checked={values.position === p}
                    tabIndex={values.position === p ? 0 : -1}
                    onClick={() => set('position', p)}
                    onKeyDown={(e) => {
                      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                        e.preventDefault();
                        const next = p === 'bottom-left' ? 'bottom-right' : 'bottom-left';
                        set('position', next);
                        const sibling = (e.currentTarget.parentElement?.querySelector(
                          `[data-value="${next}"]`,
                        ) ?? null) as HTMLButtonElement | null;
                        sibling?.focus();
                      }
                    }}
                    data-value={p}
                  >
                    {t(p === 'bottom-right' ? 'widgetForm.positionBottomRight' : 'widgetForm.positionBottomLeft')}
                  </button>
                ))}
              </div>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-welcome`}>
                {t('widgetForm.welcomeMessage')}
              </label>
              <textarea
                id={`${uid}-welcome`}
                className="textarea"
                rows={3}
                value={values.welcomeMessage}
                placeholder={t('widgetForm.welcomePlaceholder')}
                onChange={(e) => set('welcomeMessage', e.target.value)}
              />
            </div>
            <div className="ui-field">
              <label className="ui-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={values.helpEnabled}
                  onChange={(e) => set('helpEnabled', e.target.checked)}
                />
                {t('help.enabled')}
              </label>
              <p className="ui-help">
                {t('help.hint')}{' '}
                {helpCenterPath && (
                  <a href={helpCenterPath} target="_blank" rel="noopener noreferrer">
                    {t('help.open')}
                  </a>
                )}
              </p>
            </div>
          </FormSection>
          <FormSection
            title={t('widgetForm.deleteTitle')}
            description={t('widgetForm.deleteSub')}
            tone="danger"
            footer={
              <>
                <p className="ui-section-note" />
                <button type="button" className="btn btn-primary btn-danger" onClick={() => setConfirmOpen(true)}>
                  {t('widgetForm.delete')}
                </button>
              </>
            }
          />
          <dialog
            ref={confirmRef}
            className="ui-modal"
            aria-labelledby={`${uid}-confirm-title`}
            aria-describedby={`${uid}-confirm-body`}
            onClose={() => setConfirmOpen(false)}
          >
            <div className="ui-modal-head">
              <h2 className="ui-modal-title" id={`${uid}-confirm-title`}>
                {t('widgetForm.deleteConfirmTitle', { name: widget.name })}
              </h2>
            </div>
            <div className="ui-modal-body">
              <p id={`${uid}-confirm-body`} className="chat-confirm-body">
                {t('widgetForm.deleteConfirmBody', { count: conversationCount })}
              </p>
              {deleteError && (
                <p className="ui-error" role="alert">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)} autoFocus>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-danger"
                onClick={remove}
                disabled={deleting}
                aria-busy={deleting || undefined}
              >
                {t('widgetForm.deleteConfirmAction')}
              </button>
            </div>
          </dialog>
        </>
      )}

      {tab === 'form' && (
        <FormSection title={t('widgetForm.formTitle')} description={t('widgetForm.formSub')} onSubmit={save}>
          {fields.length === 0 ? (
            <p className="chat-quiet">{t('widgetForm.noFields')}</p>
          ) : (
            <div className="chat-field-rows" role="list">
              {fields.map((f, i) => (
                <div key={f.id} className="chat-field-row" role="listitem">
                  <input
                    className="input"
                    aria-label={t('widgetForm.fieldName')}
                    placeholder={t('widgetForm.fieldName')}
                    value={f.name}
                    maxLength={80}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                  />
                  <select
                    className="select"
                    aria-label={t('widgetForm.fieldType')}
                    value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value as WidgetFormField['type'] })}
                  >
                    <option value="text">{t('widgetForm.fieldTypeText')}</option>
                    <option value="email">{t('visitorPanel.email')}</option>
                    <option value="number">{t('widgetForm.fieldTypeNumber')}</option>
                  </select>
                  <label className="ui-check">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                    />
                    {t('widgetForm.fieldRequired')}
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={t('widgetForm.removeField', { name: f.name || t('widgetForm.fieldName') })}
                    title={t('common.delete')}
                    onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <ChatIcon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFields((p) => [...p, emptyField()])}>
              {t('widgetForm.addField')}
            </button>
          </div>
        </FormSection>
      )}

      {tab === 'bot' && (
        <FormSection title={t('widgetForm.botTitle')} description={t('widgetForm.botSub')} onSubmit={save}>
          <label className="ui-switch">
            <input
              type="checkbox"
              role="switch"
              checked={values.botEnabled}
              onChange={(e) => set('botEnabled', e.target.checked)}
            />
            {t('bot.enabled')}
          </label>
          {values.botEnabled ? (
            <>
              <div className="ui-field">
                <label className="label" htmlFor={`${uid}-greeting`}>
                  {t('bot.greeting')}
                </label>
                <textarea
                  id={`${uid}-greeting`}
                  className="textarea"
                  rows={2}
                  placeholder={t('bot.greetingPlaceholder')}
                  value={values.botGreeting}
                  onChange={(e) => set('botGreeting', e.target.value)}
                />
              </div>
              <AdvancedSection storageKey="chat.widget.bot" hint={t('bot.source')}>
                <div className="ui-field">
                  <label className="label" htmlFor={`${uid}-source`}>
                    {t('bot.source')}
                  </label>
                  <select
                    id={`${uid}-source`}
                    className="select"
                    value={values.botSource}
                    onChange={(e) => set('botSource', e.target.value as WidgetFormValues['botSource'])}
                  >
                    <option value="canned">{t('bot.sourceCanned')}</option>
                    <option value="docs">{t('bot.sourceDocs')}</option>
                    <option value="ai">{t('bot.sourceAi')}</option>
                    {widget.bot_source === 'agent' && <option value="agent">{t('bot.sourceAgent')}</option>}
                  </select>
                  <p className="ui-help">
                    {t(values.botSource === 'agent' ? 'bot.hintAgent' : values.botSource === 'ai' ? 'bot.hintAi' : 'bot.hint')}
                  </p>
                  {values.botSource === 'ai' && !aiAvailable && <p className="ui-error">{t('bot.aiNotConfigured')}</p>}
                </div>
              </AdvancedSection>
            </>
          ) : (
            <p className="chat-quiet">{t('bot.disabled')}</p>
          )}
        </FormSection>
      )}

      {tab === 'hours' && (
        <FormSection
          title={t('widgetForm.hoursTitle')}
          description={t('officeHours.hint')}
          note={office.enabled ? t('officeHours.zoneNote', { zone: office.timezone }) : undefined}
          onSubmit={save}
        >
          <label className="ui-switch">
            <input
              type="checkbox"
              role="switch"
              checked={office.enabled}
              onChange={(e) => setOffice((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            {t('officeHours.enabled')}
          </label>
          {office.enabled ? (
            <>
              <div className="chat-days" role="list">
                {DAY_ORDER.map((i) => {
                  const d = office.days[i];
                  const dayLabel = t(`widgetForm.days.${DAY_KEYS[i]}`);
                  return (
                    <div key={i} className="chat-day" role="listitem" data-off={!d.enabled || undefined}>
                      <label className="ui-check">
                        <input
                          type="checkbox"
                          checked={d.enabled}
                          onChange={(e) => updateDay(i, { enabled: e.target.checked })}
                        />
                        {dayLabel}
                      </label>
                      <input
                        type="time"
                        className="input data"
                        aria-label={t('officeHours.from', { day: dayLabel })}
                        value={d.start}
                        disabled={!d.enabled}
                        onChange={(e) => updateDay(i, { start: e.target.value })}
                      />
                      <span className="chat-day-sep" aria-hidden="true">
                        –
                      </span>
                      <input
                        type="time"
                        className="input data"
                        aria-label={t('officeHours.to', { day: dayLabel })}
                        value={d.end}
                        disabled={!d.enabled}
                        onChange={(e) => updateDay(i, { end: e.target.value })}
                      />
                    </div>
                  );
                })}
              </div>
              <AdvancedSection storageKey="chat.widget.hours" hint={t('officeHours.timezone')}>
                <div className="ui-field">
                  <label className="label" htmlFor={`${uid}-tz`}>
                    {t('officeHours.timezone')}
                  </label>
                  <input
                    id={`${uid}-tz`}
                    className="input"
                    list={`${uid}-zones`}
                    value={office.timezone}
                    onChange={(e) => setOffice((prev) => ({ ...prev, timezone: e.target.value }))}
                  />
                  <datalist id={`${uid}-zones`}>
                    {timezones.map((tz) => (
                      <option key={tz} value={tz} />
                    ))}
                  </datalist>
                </div>
              </AdvancedSection>
            </>
          ) : (
            <p className="chat-quiet">{t('officeHours.disabled')}</p>
          )}
        </FormSection>
      )}
    </SettingsTabs>
  );
}
