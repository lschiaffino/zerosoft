'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import ChatIcon from './icons';

interface EmbedCodeProps {
  widgetId: string;
  /** Origen público resuelto en el server (mismo valor en SSR y en el cliente). */
  origin: string;
}

/** El snippet para pegar en el sitio, con copiar. Es el primer paso de un widget nuevo. */
export default function EmbedCode({ widgetId, origin }: EmbedCodeProps) {
  const t = useTranslations('chat');
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const script = `<script src="${origin}/api/chat/widget.js?id=${widgetId}" async></script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setState('copied');
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 2000);
  }

  return (
    <FormSection
      title={t('embed.title')}
      description={t('embed.instructions')}
      footer={
        <>
          <p className="ui-section-note" role="status" data-tone={state === 'copied' ? 'ok' : state === 'error' ? 'error' : undefined}>
            {state === 'copied' ? t('embed.copied') : state === 'error' ? t('embed.copyError') : null}
          </p>
          <button type="button" className="btn btn-secondary" onClick={copy}>
            <ChatIcon name="copy" size={14} />
            {t('embed.copy')}
          </button>
        </>
      }
    >
      <pre className="chat-embed-code data" tabIndex={0} aria-label={t('embed.title')}>
        {script}
      </pre>
    </FormSection>
  );
}
