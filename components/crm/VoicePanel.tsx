'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { VoiceSettings } from '@/lib/crm-voice';

interface VoicePanelProps {
  configured: boolean;
  /** Variables de entorno que faltan en el server. */
  missing: string[];
  settings: VoiceSettings;
  /** Voice URL de la TwiML App y del número (para pegar en Twilio). */
  twimlUrl: string;
  inboundUrl: string;
  canEdit: boolean;
  languages: readonly string[];
  defaultConsent: string;
}

/** Llamadas desde el navegador (Twilio) en Ajustes del CRM: número, grabación con aviso, transcripción y entrantes. */
export default function VoicePanel({
  configured,
  missing,
  settings,
  twimlUrl,
  inboundUrl,
  canEdit,
  languages,
  defaultConsent,
}: VoicePanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [form, setForm] = useState<VoiceSettings>({ ...settings, consentText: settings.consentText || defaultConsent });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof VoiceSettings>(k: K, v: VoiceSettings[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !canEdit) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/voice/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string; settings?: VoiceSettings } | null;
    setBusy(false);
    if (!res?.ok) {
      setError(data?.error && t.has(`voice.errors.${data.error}`) ? t(`voice.errors.${data.error}`) : t('voice.errors.failed'));
      return;
    }
    if (data?.settings) setForm({ ...data.settings, consentText: data.settings.consentText || defaultConsent });
    setSaved(true);
    router.refresh();
  }

  if (!configured) {
    return (
      <div className="voice-panel">
        <p className="ui-help">{t('voice.settings.notConfigured')}</p>
        <p className="muted">
          {t('voice.settings.missing')} <code>{missing.join(', ')}</code>
        </p>
        <p className="muted gmail-hint">
          {t('voice.settings.twimlHint')} <code>{twimlUrl}</code>
        </p>
      </div>
    );
  }

  return (
    <form className="voice-panel" onSubmit={save}>
      <label className="field">
        <span className="field-label">{t('voice.settings.callerId')}</span>
        <input
          className="input"
          type="tel"
          inputMode="tel"
          placeholder="+14155550100"
          value={form.callerId}
          disabled={!canEdit}
          onChange={(e) => set('callerId', e.target.value)}
        />
        <span className="ui-help">{t('voice.settings.callerIdHelp')}</span>
      </label>

      <label className="ui-check">
        <input type="checkbox" checked={form.recordCalls} disabled={!canEdit} onChange={(e) => set('recordCalls', e.target.checked)} />{' '}
        {t('voice.settings.record')}
      </label>
      {form.recordCalls && (
        <div className="voice-panel-nested">
          <label className="ui-check">
            <input
              type="checkbox"
              checked={form.consentEnabled}
              disabled={!canEdit}
              onChange={(e) => set('consentEnabled', e.target.checked)}
            />{' '}
            {t('voice.settings.consent')}
          </label>
          {form.consentEnabled ? (
            <label className="field">
              <span className="field-label">{t('voice.settings.consentText')}</span>
              <input
                className="input"
                value={form.consentText}
                maxLength={300}
                disabled={!canEdit}
                onChange={(e) => set('consentText', e.target.value)}
              />
            </label>
          ) : (
            <p className="gmail-warn">{t('voice.settings.consentOffWarning')}</p>
          )}
        </div>
      )}

      <label className="ui-check">
        <input type="checkbox" checked={form.transcribe} disabled={!canEdit} onChange={(e) => set('transcribe', e.target.checked)} />{' '}
        {t('voice.settings.transcribe')}
      </label>
      {form.transcribe && (
        <label className="field voice-panel-nested">
          <span className="field-label">{t('voice.settings.language')}</span>
          <select className="select" value={form.language} disabled={!canEdit} onChange={(e) => set('language', e.target.value)}>
            {languages.map((l) => (
              <option key={l} value={l}>
                {t(`voice.languages.${l}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="ui-check">
        <input type="checkbox" checked={form.inboundEnabled} disabled={!canEdit} onChange={(e) => set('inboundEnabled', e.target.checked)} />{' '}
        {t('voice.settings.inbound')}
      </label>
      {form.inboundEnabled && (
        <p className="muted gmail-hint voice-panel-nested">
          {t('voice.settings.inboundHint')} <code>{inboundUrl}</code>
        </p>
      )}

      <p className="muted gmail-hint">
        {t('voice.settings.twimlHint')} <code>{twimlUrl}</code>
      </p>

      {canEdit ? (
        <div className="form-actions">
          <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
          {saved && (
            <span className="muted" role="status">
              {t('common.saved')}
            </span>
          )}
        </div>
      ) : (
        <p className="ui-help">{t('common.adminOnly')}</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
