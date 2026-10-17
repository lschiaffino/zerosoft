'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import CalCopyButton from './CalCopyButton';

interface View {
  configured: boolean;
  keyHint: string | null;
  mode: 'test' | 'live' | null;
  hasWebhookSecret: boolean;
  webhookPath: string;
}

/** Conexión con la cuenta de Stripe del workspace (clave y signing secret, guardados cifrados). */
export default function PaymentsSettingsPanel({ initial, origin, canEdit }: { initial: View; origin: string; canEdit: boolean }) {
  const t = useTranslations('calendar');
  const id = useId();
  const [view, setView] = useState(initial);
  const [key, setKey] = useState('');
  const [whsec, setWhsec] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const webhookUrl = `${origin}${view.webhookPath}`;

  async function send(body: Record<string, string>): Promise<string | undefined> {
    const res = await fetch('/api/calendar/payments', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) {
      setView((await res.json()) as View);
      setKey('');
      setWhsec('');
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  }

  async function save() {
    const body: Record<string, string> = {};
    if (key.trim()) body.stripeSecretKey = key.trim();
    if (whsec.trim()) body.stripeWebhookSecret = whsec.trim();
    if (Object.keys(body).length === 0) return t('payments.nothingToSave');
    return send(body);
  }

  async function disconnect() {
    if (!confirm(t('payments.removeConfirm'))) return;
    setRemoving(true);
    setRemoveError((await send({ stripeSecretKey: '', stripeWebhookSecret: '' })) ?? null);
    setRemoving(false);
  }

  const status = view.configured && view.keyHint ? t('payments.connected', { hint: view.keyHint, mode: view.mode ?? '' }) : t('payments.notConnected');

  return (
    <FormSection
      title={t('payments.settingsTitle')}
      description={t('payments.settingsSub')}
      onSubmit={canEdit ? save : undefined}
      footer={canEdit ? undefined : <p className="ui-section-note">{t('payments.adminOnly')}</p>}
    >
      <p className="cal-status-line">
        <span className={view.configured ? 'badge badge-ok' : 'badge'}>{view.configured ? t('payments.on') : t('payments.off')}</span>
        <span className="data">{status}</span>
      </p>
      {view.configured && !view.hasWebhookSecret && <p className="cal-callout">{t('payments.webhookMissing')}</p>}
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-key`}>
            {t('payments.secretKey')}
          </label>
          <input
            id={`${id}-key`}
            className="input data"
            type="password"
            autoComplete="off"
            value={key}
            placeholder={view.configured ? t('payments.keepKey') : 'sk_live_…'}
            onChange={(e) => setKey(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-whsec`}>
            {t('payments.webhookSecret')}
          </label>
          <input
            id={`${id}-whsec`}
            className="input data"
            type="password"
            autoComplete="off"
            value={whsec}
            placeholder={view.hasWebhookSecret ? t('payments.keepKey') : 'whsec_…'}
            onChange={(e) => setWhsec(e.target.value)}
            disabled={!canEdit}
          />
        </div>
      </div>
      <div className="ui-field">
        <span className="label">{t('payments.webhookUrl')}</span>
        <div className="cal-share-url">
          <span className="data">{webhookUrl}</span>
          <CalCopyButton text={webhookUrl} label={t('payments.copyUrl')} />
        </div>
        <p className="ui-help">{t('payments.webhookHint')}</p>
      </div>
      {canEdit && view.configured && (
        <div className="cal-danger-row">
          <button type="button" className="btn btn-sm btn-danger" onClick={disconnect} aria-busy={removing || undefined}>
            {t('payments.remove')}
          </button>
          {removeError && <span className="ui-error">{removeError}</span>}
        </div>
      )}
    </FormSection>
  );
}
