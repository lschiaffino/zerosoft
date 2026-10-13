'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface GmailPanelProps {
  connected: boolean;
  email: string;
  /** Fecha de última sync ya formateada por el server (null si nunca). */
  lastSync: string | null;
  /** Valor de ?gmail= tras el callback OAuth (connected | denied | error). */
  notice: string | null;
  /** Redirect URI a registrar en Google Cloud Console. */
  redirectUri: string;
  /** El token incluye gmail.send (conexiones viejas eran solo lectura). */
  canSend?: boolean;
}

/** Panel de integración Gmail en CRM settings: connect / sync now / disconnect. */
export default function GmailPanel({ connected, email, lastSync, notice, redirectUri, canSend = true }: GmailPanelProps) {
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
    const res = await fetch('/api/integrations/gmail/sync', { method: 'POST' }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError(res?.status === 409 ? t('settings.gmailSyncInProgress') : t('settings.gmailSyncFailed'));
      return;
    }
    const data = (await res.json().catch(() => null)) as { synced?: number } | null;
    setResult(t('settings.gmailSynced', { count: data?.synced ?? 0 }));
    router.refresh();
  }

  async function disconnect() {
    if (busy) return;
    setBusy('disconnect');
    setError(null);
    await fetch('/api/integrations/gmail/disconnect', { method: 'POST' }).catch(() => null);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="gmail-panel">
      {notice === 'connected' && <p className="muted">{t('settings.gmailConnected')}</p>}
      {notice === 'denied' && <p className="form-error">{t('settings.gmailDenied')}</p>}
      {notice === 'error' && <p className="form-error">{t('settings.gmailError')}</p>}

      {connected ? (
        <>
          <p className="gmail-status">
            <span className="badge">Gmail</span> {t('settings.gmailConnectedAs', { email })}
          </p>
          {lastSync && <p className="muted">{t('settings.gmailLastSync', { date: lastSync })}</p>}
          <p className="muted">{t('settings.gmailAuto')}</p>
          {!canSend && (
            <p className="gmail-warn">
              {t('settings.gmailSendMissing')}{' '}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="link-btn" href="/api/integrations/gmail/start">
                {t('settings.gmailReconnect')}
              </a>
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-solid btn-small"
              disabled={busy !== null}
              onClick={sync}
            >
              {busy === 'sync' ? t('settings.gmailSyncing') : t('settings.gmailSyncNow')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={busy !== null}
              onClick={disconnect}
            >
              {busy === 'disconnect' ? '…' : t('settings.gmailDisconnect')}
            </button>
          </div>
          {result && <p className="muted">{result}</p>}
          {error && <p className="form-error">{error}</p>}
        </>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn btn-solid btn-small" href="/api/integrations/gmail/start">
            {t('settings.gmailConnect')}
          </a>
          <p className="muted">{t('settings.gmailPersonal')}</p>
          <p className="muted gmail-hint">
            {t('settings.gmailRedirectHint')} <code>{redirectUri}</code>
          </p>
        </>
      )}
    </div>
  );
}
