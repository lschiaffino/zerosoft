'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import type { SendBranding } from '@/lib/send/core';
import { api, useErrorText, useToast } from './ui';

/** Ajustes de Send: la marca que ve quien abre un link. Solo admins la cambian. */
export default function SendSettings({ initial, admin }: { initial: SendBranding; admin: boolean }) {
  const t = useTranslations('send.settings');
  const errorText = useErrorText();
  const [toasts, toast] = useToast();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof SendBranding) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await api<{ branding: SendBranding }>('/api/send/settings', { method: 'PUT', json: v });
    setBusy(false);
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    setV(r.data.branding);
    toast(t('saved'));
  };

  return (
    <div className="app-page ui-page sd-page sd-narrow">
      {toasts}
      <PageHeader title={t('title')} description={t('desc')} />
      <form className="sd-form" onSubmit={submit}>
        <fieldset className="sd-fieldset sd-plain" disabled={!admin}>
          <div className="sd-field">
            <label htmlFor="ss-name">{t('brandName')}</label>
            <input id="ss-name" className="input" value={v.brandName} maxLength={80} onChange={set('brandName')} data-testid="send-brand-name" />
          </div>
          <div className="sd-field">
            <label htmlFor="ss-logo">{t('logoUrl')}</label>
            <input id="ss-logo" className="input" type="url" value={v.logoUrl} maxLength={500} onChange={set('logoUrl')} placeholder="https://acme.com/logo.png" />
            <p className="sd-help">{t('logoHelp')}</p>
          </div>
          <div className="sd-field">
            <label htmlFor="ss-color">{t('color')}</label>
            <div className="sd-color">
              <input id="ss-color" type="color" value={v.brandColor || '#0b7285'} onChange={set('brandColor')} data-testid="send-brand-color" />
              <span className="num">{v.brandColor || t('colorNone')}</span>
            </div>
            <p className="sd-help">{t('colorHelp')}</p>
          </div>
          <div className="sd-field">
            <label htmlFor="ss-site">{t('siteUrl')}</label>
            <input id="ss-site" className="input" type="url" value={v.siteUrl} maxLength={500} onChange={set('siteUrl')} placeholder="https://acme.com" />
          </div>
        </fieldset>
        {admin ? (
          <div className="sd-actions">
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="send-brand-save">
              {t('save')}
            </button>
          </div>
        ) : (
          <p className="sd-help">{t('adminsOnly')}</p>
        )}
      </form>
    </div>
  );
}
