'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import type { ChatApp } from '@/lib/assistant/chat-access';

/**
 * Ajustes › Cuenta › Acceso del asistente: qué chats puede leer el asistente
 * sin preguntar ("siempre") y el botón para apagarlo. Los de "esta vez" no
 * se listan: terminan con su charla (y Apagar también los saca).
 */
export default function ChatAccessSettings({ apps, always }: { apps: ChatApp[]; always: ChatApp[] }) {
  const t = useTranslations('assistant.access');
  const [allowed, setAllowed] = useState(new Set(always));
  const [busy, setBusy] = useState<ChatApp | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function revoke(app: ChatApp) {
    setBusy(app);
    setStatus(null);
    const res = await fetch(`/api/assistant/chat-access/${app}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setStatus({ ok: false, text: t('error') });
      return;
    }
    setAllowed((prev) => {
      const next = new Set(prev);
      next.delete(app);
      return next;
    });
    setStatus({ ok: true, text: t('revoked') });
  }

  return (
    <FormSection title={t('title')} description={t('desc')}>
      <ul className="asst-access" data-testid="assistant-chat-access">
        {apps.map((app) => (
          <li key={app} className="asst-access-row" data-app={app} data-allowed={allowed.has(app) ? 'always' : 'ask'}>
            <span className="asst-access-name">{t(`app.${app}`)}</span>
            <span className="asst-access-state muted">{allowed.has(app) ? t('always') : t('off')}</span>
            {/* Apagar también saca los permisos de "esta vez" que sigan abiertos. */}
            {allowed.has(app) ? (
              <button type="button" className="btn btn-sm" onClick={() => void revoke(app)} disabled={busy === app} aria-label={`${t('revoke')}: ${t(`app.${app}`)}`}>
                {t('revoke')}
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>
      {status && (
        <p className={status.ok ? 'ui-section-note' : 'form-error'} role={status.ok ? 'status' : 'alert'}>
          {status.text}
        </p>
      )}
    </FormSection>
  );
}
