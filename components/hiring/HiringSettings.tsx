'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import type { SettingsDto } from '@/lib/hiring/core';
import { api, useErrorText, useToast } from './ui';

export default function HiringSettings({ initial, canAdmin, careersUrl, repliesEnabled }: { initial: SettingsDto; canAdmin: boolean; careersUrl: string; repliesEnabled: boolean }) {
  const t = useTranslations('hiring');
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(careersUrl);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api<{ settings: SettingsDto }>('/api/hiring/settings', { method: 'PUT', json: s });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setS(res.data.settings);
    setUrl(careersUrl.replace(/\/careers\/[^/]+$/, `/careers/${res.data.settings.handle}`));
    push(t('common.saved'));
  };

  return (
    <div className="app-page ui-page hr-page hr-narrow">
      <PageHeader title={t('settings.title')} description={t('settings.desc')} />
      {!canAdmin && <p className="ui-help">{t('settings.adminOnly')}</p>}
      <form className="ui-fields" onSubmit={save}>
        <fieldset disabled={!canAdmin} className="ui-fields hr-fieldset-plain">
          <section className="ui-fields">
            <h2 className="hr-panel-title">{t('settings.careersPage')}</h2>
            <label className="ui-switch">
              <input type="checkbox" role="switch" checked={s.published} onChange={(e) => setS({ ...s, published: e.target.checked })} aria-label={t('settings.published')} />
              {t('settings.published')}
            </label>
            <p className="ui-help">
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </p>
            <div className="ui-fields-2">
              <label className="ui-field">
                <span className="label">{t('settings.handle')}</span>
                <input className="input" required pattern="[a-z0-9][a-z0-9-]{1,39}" maxLength={40} value={s.handle} onChange={(e) => setS({ ...s, handle: e.target.value.toLowerCase() })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('settings.company')}</span>
                <input className="input" required maxLength={80} value={s.company} onChange={(e) => setS({ ...s, company: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('settings.language')}</span>
                <select className="select" value={s.locale} onChange={(e) => setS({ ...s, locale: e.target.value })}>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="pt">Português</option>
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('settings.color')}</span>
                <input className="input hr-color" type="color" value={s.color ?? '#111111'} onChange={(e) => setS({ ...s, color: e.target.value })} />
              </label>
            </div>
            <label className="ui-field">
              <span className="label">{t('settings.intro')}</span>
              <textarea className="textarea" rows={4} maxLength={2000} value={s.intro} onChange={(e) => setS({ ...s, intro: e.target.value })} />
            </label>
            <p className="ui-help">{t('settings.brandHelp')}</p>
          </section>
          <section className="ui-fields">
            <h2 className="hr-panel-title">{t('settings.emails')}</h2>
            <label className="ui-check">
              <input type="checkbox" checked={s.autoAck} onChange={(e) => setS({ ...s, autoAck: e.target.checked })} />
              {t('settings.autoAck')}
            </label>
            <p className="ui-help">{repliesEnabled ? t('settings.repliesOn') : t('settings.repliesOff')}</p>
          </section>
          <section className="ui-fields">
            <h2 className="hr-panel-title">{t('settings.privacy')}</h2>
            <label className="ui-field">
              <span className="label">{t('settings.retention')}</span>
              <select className="select" value={s.retentionMonths} onChange={(e) => setS({ ...s, retentionMonths: Number(e.target.value) })}>
                {[0, 6, 12, 18, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? t('settings.retentionOff') : t('settings.months', { count: m })}
                  </option>
                ))}
              </select>
              <span className="ui-help">{t('settings.retentionHelp')}</span>
            </label>
            <label className="ui-field">
              <span className="label">{t('settings.consentText')}</span>
              <textarea className="textarea" rows={3} maxLength={1000} placeholder={t('apply.consentDefault', { company: s.company })} value={s.consentText} onChange={(e) => setS({ ...s, consentText: e.target.value })} />
            </label>
          </section>
          <div className="hr-actions-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
          </div>
        </fieldset>
      </form>
      {toast}
    </div>
  );
}
