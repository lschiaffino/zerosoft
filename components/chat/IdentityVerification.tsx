'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import ChatIcon from './icons';

interface IdentityVerificationProps {
  widgetId: string;
  /** Owner/admin: ve el secreto y lo puede generar o apagar. */
  canManage: boolean;
  initialSecret: string | null;
}

/**
 * Secreto para firmar el email del visitante (HMAC-SHA256) en el server del
 * sitio. Con firma válida el email queda verificado en el inbox; sin firma es
 * declarado y no se asocia solo a contactos del CRM (lib/chat-identity.ts).
 */
export default function IdentityVerification({ widgetId, canManage, initialSecret }: IdentityVerificationProps) {
  const t = useTranslations('chat');
  const [secret, setSecret] = useState(initialSecret);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: 'POST' | 'DELETE') {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/chat/widgets/${widgetId}/identity`, { method }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { secret?: string } | null) : null;
    setBusy(false);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    setSecret(method === 'POST' ? (data?.secret ?? null) : null);
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('embed.copyError'));
    }
  }

  return (
    <FormSection title={t('identity.title')} description={t('identity.description')}>
      {!canManage ? (
        <p className="ui-help">{t('identity.adminOnly')}</p>
      ) : secret ? (
        <>
          <p className="ui-help">{t('identity.instructions')}</p>
          <div className="chat-embed">
            <pre className="chat-embed-code data" tabIndex={0} aria-label={t('identity.secretLabel')}>
              {secret}
            </pre>
            <button type="button" className="btn btn-secondary" onClick={copy}>
              <ChatIcon name="copy" size={14} />
              {copied ? t('identity.copied') : t('identity.copy')}
            </button>
          </div>
          <p className="ui-help">{t('identity.regenerateHint')}</p>
          <div className="chat-embed">
            <button type="button" className="btn" onClick={() => call('POST')} disabled={busy} aria-busy={busy || undefined}>
              {t('identity.regenerate')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => call('DELETE')} disabled={busy}>
              {t('identity.turnOff')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="ui-help">{t('identity.off')}</p>
          <div className="chat-embed">
            <button type="button" className="btn" onClick={() => call('POST')} disabled={busy} aria-busy={busy || undefined}>
              {t('identity.generate')}
            </button>
          </div>
        </>
      )}
      <p className="sr-only" role="status">
        {copied ? t('identity.copied') : null}
      </p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </FormSection>
  );
}
