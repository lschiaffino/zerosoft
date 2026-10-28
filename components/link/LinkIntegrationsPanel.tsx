'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { LinkIntegrationKey, LinkIntegrationView } from '@/lib/link-integrations';
import { parseDbUtc } from '@/lib/utils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CopyButton from './CopyButton';

/** Shopify (ventas) y Segment (eventos) de Link: conectar, estado y desconectar. */
export default function LinkIntegrationsPanel({
  initial,
  canEdit,
  only,
}: {
  initial: LinkIntegrationView[];
  canEdit: boolean;
  only?: LinkIntegrationKey[];
}) {
  const t = useTranslations('link');
  const locale = useLocale();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<LinkIntegrationKey | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: LinkIntegrationKey; text: string } | null>(null);
  const [confirm, setConfirm] = useState<LinkIntegrationKey | null>(null);

  const fmt = (d: string | null) =>
    d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(d)) : '';

  async function connect(e: FormEvent, key: LinkIntegrationKey) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/links/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: key, secret }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { integrations?: LinkIntegrationView[]; error?: string } | null;
    if (res?.ok && data?.integrations) {
      setItems(data.integrations);
      setOpen(null);
      setSecret('');
    } else {
      const code = data?.error ?? 'generic';
      setError({ key, text: t.has(`integrations.errors.${code}`) ? t(`integrations.errors.${code}`) : t('errors.generic') });
    }
  }

  async function disconnect(key: LinkIntegrationKey) {
    setBusy(true);
    const res = await fetch(`/api/links/integrations?kind=${key}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirm(null);
    const data = (await res?.json().catch(() => null)) as { integrations?: LinkIntegrationView[] } | null;
    if (res?.ok && data?.integrations) setItems(data.integrations);
    else setError({ key, text: t('errors.generic') });
  }

  return (
    <div className="crm-apps" data-testid="link-integrations">
      <ul className="crm-apps-grid">
        {items
          .filter((i) => !only || only.includes(i.key))
          .map((i) => {
            const status = i.connected ? (i.lastError ? 'error' : 'connected') : 'off';
            return (
              <li key={i.key} className="crm-app-card" data-testid={`link-integration-${i.key}`}>
                <div className="crm-app-head">
                  <span className="crm-app-mark" aria-hidden="true">
                    {t(`integrations.${i.key}.name`).slice(0, 1)}
                  </span>
                  <div className="crm-app-title">
                    <h3>{t(`integrations.${i.key}.name`)}</h3>
                    <p className="ui-help">{t(`integrations.${i.key}.desc`)}</p>
                  </div>
                  <span className={`badge ${status === 'connected' ? 'badge-ok' : status === 'error' ? 'badge-bad' : ''}`}>
                    {t(`integrations.status.${status}`)}
                  </span>
                </div>
                {i.connected && (
                  <p className="muted crm-app-meta">
                    {t('integrations.connectedOn', { date: fmt(i.connectedAt) })}
                    {i.lastUsedAt ? ` · ${t('integrations.lastUsed', { date: fmt(i.lastUsedAt) })}` : ''}
                  </p>
                )}
                {i.connected && i.lastError && <p className="ui-error">{t('integrations.lastError', { error: i.lastError })}</p>}
                {error?.key === i.key && (
                  <p className="ui-error" role="alert">
                    {error.text}
                  </p>
                )}
                {i.connected ? (
                  <div className="crm-app-connected">
                    {i.hint && <p className="data muted crm-app-hint">{i.hint}</p>}
                    {i.webhookUrl && (
                      <div className="ui-field">
                        <span className="label">{t('integrations.shopify.endpoint')}</span>
                        <div className="crm-app-copy">
                          <code className="data">{i.webhookUrl}</code>
                          <CopyButton text={i.webhookUrl} className="btn btn-secondary btn-sm" />
                        </div>
                        <p className="ui-help">{t('integrations.shopify.endpointHelp')}</p>
                      </div>
                    )}
                    {i.key === 'segment' && <p className="ui-help">{t('integrations.segment.connectedHelp')}</p>}
                    {canEdit && (
                      <div className="crm-app-actions">
                        <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirm(i.key)} disabled={busy}>
                          {t('integrations.disconnect')}
                        </button>
                      </div>
                    )}
                  </div>
                ) : open === i.key ? (
                  <form
                    className="crm-app-form"
                    onSubmit={(e) => connect(e, i.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setOpen(null);
                    }}
                  >
                    <p className="ui-help">{t(`integrations.${i.key}.help`)}</p>
                    <div className="ui-field">
                      <label className="label" htmlFor={`li-${i.key}`}>
                        {t(`integrations.${i.key}.secret`)}
                      </label>
                      <input
                        id={`li-${i.key}`}
                        className="input data"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        required
                        autoFocus
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                      />
                    </div>
                    <div className="crm-app-actions">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !secret.trim()} aria-busy={busy || undefined}>
                        {t('integrations.connect')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  canEdit && (
                    <div className="crm-app-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setSecret('');
                          setError(null);
                          setOpen(i.key);
                        }}
                      >
                        {t('integrations.connect')}
                      </button>
                    </div>
                  )
                )}
              </li>
            );
          })}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t('integrations.disconnectTitle', { app: t(`integrations.${confirm}.name`) }) : ''}
        body={t('integrations.disconnectBody')}
        confirmLabel={t('integrations.disconnect')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => confirm && disconnect(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
