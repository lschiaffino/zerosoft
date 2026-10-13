'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buildRecorderScript, PASSWORD_PLACEHOLDER, recorderBookmarklet, type RecorderLabels } from '@/lib/robots-recorder';

/** /app/robots/recorder: bookmarklet para grabar pasos en cualquier sitio. */
export default function RecorderPage() {
  const t = useTranslations('robots.recorder');
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  const labels = useMemo<RecorderLabels>(
    () => ({
      recording: t('panel.recording'),
      steps: t('panel.steps'),
      copy: t('panel.copy'),
      copied: t('panel.copied'),
      clear: t('panel.clear'),
      close: t('panel.close'),
      hint: t('panel.hint'),
    }),
    [t],
  );

  // React 19 bloquea href="javascript:…": se asigna directo en el DOM.
  useEffect(() => {
    linkRef.current?.setAttribute('href', recorderBookmarklet(labels));
  }, [labels]);

  async function copyCode() {
    await navigator.clipboard?.writeText(buildRecorderScript(labels)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="app-page robots-recorder">
      <Link href="/app/robots" className="robots-back">
        ← {t('back')}
      </Link>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="muted robots-sub">{t('subtitle')}</p>
        </div>
      </div>

      <section className="robots-recorder-drag">
        <a
          ref={linkRef}
          className="robots-bookmarklet"
          draggable
          onClick={(e) => e.preventDefault()}
          title={t('dragHint')}
        >
          {t('bookmarklet')}
        </a>
        <p className="muted">{t('dragHint')}</p>
      </section>

      <section className="robots-recorder-section">
        <h2 className="robots-section-title">{t('howTitle')}</h2>
        <ol className="robots-recorder-steps">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
          <li>{t('step4')}</li>
        </ol>
      </section>

      <section className="robots-recorder-section">
        <h2 className="robots-section-title">{t('selectorsTitle')}</h2>
        <p className="muted">{t('selectors')}</p>
        <p className="muted">{t('passwords', { placeholder: PASSWORD_PLACEHOLDER })}</p>
      </section>

      <section className="robots-recorder-section">
        <button type="button" className="btn btn-small" onClick={() => void copyCode()}>
          {copied ? t('copied') : t('copyCode')}
        </button>
        <p className="muted robots-hint">{t('copyCodeHint')}</p>
      </section>
    </div>
  );
}
