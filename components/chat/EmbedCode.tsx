'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface EmbedCodeProps {
  widgetId: string;
  /** Origen público resuelto en el server (mismo valor en SSR y en el cliente). */
  origin: string;
}

export default function EmbedCode({ widgetId, origin }: EmbedCodeProps) {
  const t = useTranslations('chat');
  const [copied, setCopied] = useState(false);
  // Antes usaba window.location.origin en el cliente y un fallback distinto en
  // el server → hydration mismatch. Ahora el origen llega del server.
  const script = `<script src="${origin}/api/chat/widget.js?id=${widgetId}" async></script>`;

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
