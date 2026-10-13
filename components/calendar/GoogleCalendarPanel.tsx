'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface Props {
  configured: boolean;
  connectedEmail: string | null;
  notice: string | null;
  redirectUri: string;
}

/** Conectar/desconectar el Google Calendar de la persona logueada. */
export default function GoogleCalendarPanel({ configured, connectedEmail, notice, redirectUri }: Props) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    await fetch('/api/integrations/google-calendar/disconnect', { method: 'POST' }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  const noticeText =
    notice === 'connected'
      ? t('google.noticeConnected')
      : notice === 'scopes'
        ? t('google.noticeScopes')
        : notice === 'denied' || notice === 'error'
          ? t('google.noticeError')
          : null;

  return (
    <section className="panel">
      <p className="section-label">Google Calendar</p>
      <p className="muted">{t('google.desc')}</p>
      {noticeText && <p className={notice === 'connected' ? 'saved-note' : 'form-error'}>{noticeText}</p>}
      {!configured ? (
        <p className="muted mono cal-wrap">{t('google.notConfigured', { uri: redirectUri })}</p>
      ) : connectedEmail ? (
        <div className="calendar-public-link">
          <span className="mono">{t('google.connectedAs', { email: connectedEmail })}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={disconnect} disabled={busy}>
            {t('google.disconnect')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-solid btn-small"
          onClick={() => {
            // Navegación completa: el endpoint redirige a la pantalla de consentimiento de Google.
            window.location.href = '/api/integrations/google-calendar/start';
          }}
        >
          {t('google.connect')}
        </button>
      )}
    </section>
  );
}
