'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';

/** Ajustes de la app: retención por defecto de los formularios nuevos (solo admins). */
export default function FormsSettings({ defaults, admin }: { defaults: { retentionDays: number }; admin: boolean }) {
  const t = useTranslations('forms.settings');
  const [days, setDays] = useState(defaults.retentionDays);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/forms/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retentionDays: days }) }).catch(() => null);
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: t('saved') } : { ok: false, text: t('error') });
  }
  return (
    <div className="app-page ui-page fm-page">
      <PageHeader title={t('title')} description={t('desc')} />
      <form className="ui-fields fm-settings-page" onSubmit={save}>
        <div className="ui-field">
          <label className="label" htmlFor="fm-def-retention">
            {t('retention')}
          </label>
          <select id="fm-def-retention" className="select" value={days} disabled={!admin} onChange={(e) => setDays(Number(e.target.value))}>
            {[0, 30, 90, 180, 365, 730].map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t('forever') : t('days', { n: d })}
              </option>
            ))}
          </select>
          <p className="ui-help">{admin ? t('retentionHelp') : t('adminOnly')}</p>
        </div>
        <p className="ui-help">{t('privacy')}</p>
        {admin && (
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('save')}
            </button>
          </div>
        )}
        {msg && (
          <p className={msg.ok ? 'fm-msg fm-msg-ok' : 'fm-error'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}
      </form>
    </div>
  );
}
