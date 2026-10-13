'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CopyButton from '@/components/link/CopyButton';

/** Snippets para embeber la página de reserva (en línea o popup). */
export default function CalEmbedCode({ publicUrl, origin }: { publicUrl: string; origin: string }) {
  const t = useTranslations('calendar');
  const [mode, setMode] = useState<'inline' | 'popup'>('inline');
  const snippet =
    mode === 'inline'
      ? `<script src="${origin}/api/calendar/embed.js" data-url="${publicUrl}" async></script>`
      : `<script src="${origin}/api/calendar/embed.js" data-url="${publicUrl}" data-mode="popup" data-label="Book a meeting" async></script>`;

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-label">{t('embed.title')}</p>
        <CopyButton text={snippet} />
      </div>
      <div className="calendar-embed-tabs" role="tablist">
        {(['inline', 'popup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`btn btn-small ${mode === m ? 'btn-solid' : 'btn-ghost'}`}
            onClick={() => setMode(m)}
          >
            {t(`embed.${m}`)}
          </button>
        ))}
      </div>
      <p className="muted">{t(`embed.${mode}Desc`)}</p>
      <pre className="mono calendar-embed-code">{snippet}</pre>
    </section>
  );
}
