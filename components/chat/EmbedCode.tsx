'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface EmbedCodeProps {
  widgetId: string;
}

export default function EmbedCode({ widgetId }: EmbedCodeProps) {
  const t = useTranslations('chat');
  const [copied, setCopied] = useState(false);
  const script = `<script src="${typeof window !== 'undefined' ? window.location.origin : 'https://zerosoft.ai'}/api/chat/widget.js?id=${widgetId}" async></script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <section className="panel chat-embed">
      <div className="panel-head">
        <p className="section-label">{t('embed.title')}</p>
        <button type="button" className="btn btn-small" onClick={copy}>
          {copied ? t('embed.copied') : t('embed.copy')}
        </button>
      </div>
      <p className="muted">{t('embed.instructions')}</p>
      <pre className="chat-embed-code mono">{script}</pre>
    </section>
  );
}
