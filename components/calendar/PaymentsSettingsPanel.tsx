'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CopyButton from '@/components/link/CopyButton';

interface View {
  configured: boolean;
  keyHint: string | null;
  mode: 'test' | 'live' | null;
  hasWebhookSecret: boolean;
  webhookPath: string;
}

/** Conexión con la cuenta de Stripe del workspace (clave y signing secret, guardados cifrados). */
export default function PaymentsSettingsPanel({
  initial,
  origin,
  canEdit,
}: {
  initial: View;
  origin: string;
  canEdit: boolean;
}) {
  const t = useTranslations('calendar');
  const [view, setView] = useState(initial);
  const [key, setKey] = useState('');
  const [whsec, setWhsec] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webhookUrl = `${origin}${view.webhookPath}`;

  async function send(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch('/api/calendar/payments', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      setView((await res.json()) as View);
      setKey('');
      setWhsec('');
      setSaved(true);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = {};
    if (key.trim()) body.stripeSecretKey = key.trim();
    if (whsec.trim()) body.stripeWebhookSecret = whsec.trim();
    if (Object.keys(body).length === 0) return;
    void send(body);
  }

  return (
    <form className="panel cal-pay-settings" onSubmit={save}>
      <p className="section-label">{t('payments.settingsTitle')}</p>
      <p className="muted">{t('payments.settingsSub')}</p>
      <p className="mono cal-pay-status">
        {view.configured && view.keyHint
          ? t('payments.connected', { hint: view.keyHint, mode: view.mode ?? '' })
          : t('payments.notConnected')}
      </p>
      {view.configured && !view.hasWebhookSecret && <p className="cal-warn">{t('payments.webhookMissing')}</p>}
      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('payments.secretKey')}</span>
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            value={key}
            placeholder={view.configured ? t('payments.keepKey') : 'sk_live_…'}
            onChange={(e) => setKey(e.target.value)}
            disabled={!canEdit}
          />
        </label>
        <label className="field">
          <span className="prop-label">{t('payments.webhookSecret')}</span>
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            value={whsec}
            placeholder={view.hasWebhookSecret ? t('payments.keepKey') : 'whsec_…'}
            onChange={(e) => setWhsec(e.target.value)}
            disabled={!canEdit}
          />
        </label>
      </div>
      <p className="prop-label">{t('payments.webhookUrl')}</p>
      <div className="calendar-public-link">
        <span className="mono">{webhookUrl}</span>
        <CopyButton text={webhookUrl} />
      </div>
      <p className="muted cal-sched-hint">{t('payments.webhookHint')}</p>
      {!canEdit && <p className="muted">{t('payments.adminOnly')}</p>}
      {error && <p className="form-error">{error}</p>}
      {canEdit && (
        <div className="form-actions">
          {view.configured && (
            <button
              type="button"
              className="btn btn-ghost btn-small btn-danger"
              disabled={busy}
              onClick={() => void send({ stripeSecretKey: '', stripeWebhookSecret: '' })}
            >
              {t('payments.remove')}
            </button>
          )}
          <button type="submit" className="btn btn-solid" disabled={busy || (!key.trim() && !whsec.trim())}>
            {busy ? t('common.saving') : saved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      )}
    </form>
  );
}
