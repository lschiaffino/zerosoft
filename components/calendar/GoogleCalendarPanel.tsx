'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';

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
  const [failed, setFailed] = useState(false);

  async function disconnect() {
    setBusy(true);
    setFailed(false);
    const res = await fetch('/api/integrations/google-calendar/disconnect', { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) setFailed(true);
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
    <FormSection
      title="Google Calendar"
      description={t('google.desc')}
      footer={
        <>
          <p className="ui-section-note" role="status" data-tone={failed ? 'error' : undefined}>
            {failed ? t('errors.generic') : connectedEmail ? t('google.connectedAs', { email: connectedEmail }) : t('google.notConnected')}
          </p>
          {!configured ? null : connectedEmail ? (
            <button type="button" className="btn btn-danger" onClick={disconnect} aria-busy={busy || undefined}>
              {t('google.disconnect')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                // Navegación completa: el endpoint redirige a la pantalla de consentimiento de Google.
                window.location.href = '/api/integrations/google-calendar/start';
              }}
            >
              {t('google.connect')}
            </button>
          )}
        </>
      }
    >
      {noticeText && (
        <p className={notice === 'connected' ? 'cal-callout cal-callout-ok' : 'cal-callout'} role="status">
          {noticeText}
        </p>
      )}
      {!configured && <p className="ui-help cal-wrap">{t('google.notConfigured', { uri: redirectUri })}</p>}
    </FormSection>
  );
}
