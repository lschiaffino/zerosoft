'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface OutlookPanelProps {
  /** MS_CLIENT_ID / MS_CLIENT_SECRET configurados en la instancia. */
  configured: boolean;
  connected: boolean;
  email: string;
  /** Fecha de la última sync ya formateada por el server (null si nunca). */
  lastSync: string | null;
  /** Último error del sync (token_expired, graph_403…), null si anduvo. */
  syncError: string | null;
  /** Valor de ?outlook= tras el callback OAuth (connected | denied | error). */
  notice: string | null;
  /** Redirect URI a registrar en Microsoft Entra ID. */
  redirectUri: string;
}

/** Outlook / Microsoft 365 en Ajustes del CRM: conectar, sincronizar ahora y desconectar. */
export default function OutlookPanel({
  configured,
  connected,
  email,
  lastSync,
  syncError,
  notice,
  redirectUri,
}: OutlookPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    if (busy) return;
    setBusy('sync');
    setError(null);
    setResult(null);
    const res = await fetch('/api/integrations/outlook/sync', { method: 'POST' }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(
        res?.status === 409
          ? t('outlook.syncInProgress')
          : data?.error === 'token_expired'
            ? t('outlook.tokenExpired')
            : t('outlook.syncFailed'),
      );
      return;
    }
    const data = (await res.json().catch(() => null)) as { synced?: number; meetings?: number } | null;
    setResult(t('outlook.synced', { count: data?.synced ?? 0, meetings: data?.meetings ?? 0 }));
    router.refresh();
  }

  async function disconnect() {
    if (busy) return;
    setBusy('disconnect');
    setError(null);
    await fetch('/api/integrations/outlook/disconnect', { method: 'POST' }).catch(() => null);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="gmail-panel outlook-panel">
      {notice === 'connected' && <p className="muted">{t('outlook.connected')}</p>}
      {notice === 'denied' && <p className="form-error">{t('outlook.denied')}</p>}
      {notice === 'error' && <p className="form-error">{t('outlook.error')}</p>}

      {connected ? (
        <>
          <p className="gmail-status">
            <span className="badge">Outlook</span> {t('outlook.connectedAs', { email })}
          </p>
          {lastSync && <p className="muted">{t('outlook.lastSync', { date: lastSync })}</p>}
          {syncError && (
            <p className="gmail-warn">
              {syncError === 'token_expired' ? t('outlook.tokenExpired') : t('outlook.syncFailed')}{' '}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="link-btn" href="/api/integrations/outlook/start">
                {t('outlook.reconnect')}
              </a>
            </p>
          )}
          <p className="muted">{t('outlook.auto')}</p>
          <div className="form-actions">
            <button type="button" className="btn btn-solid btn-small" disabled={busy !== null} onClick={sync}>
              {busy === 'sync' ? t('outlook.syncing') : t('outlook.syncNow')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy !== null} onClick={disconnect}>
              {busy === 'disconnect' ? '…' : t('outlook.disconnect')}
            </button>
          </div>
          {result && (
            <p className="muted" role="status">
              {result}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : configured ? (
        <>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn btn-solid btn-small" href="/api/integrations/outlook/start">
            {t('outlook.connect')}
          </a>
          <p className="muted">{t('outlook.personal')}</p>
          <p className="muted gmail-hint">
            {t('outlook.redirectHint')} <code>{redirectUri}</code>
          </p>
        </>
      ) : (
        <>
          <p className="ui-help">{t('outlook.notConfigured')}</p>
          <p className="muted gmail-hint">
            {t('outlook.redirectHint')} <code>{redirectUri}</code>
          </p>
        </>
      )}
    </div>
  );
}
