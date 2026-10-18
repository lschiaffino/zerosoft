'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildRecorderScript, PASSWORD_PLACEHOLDER, recorderBookmarklet, type RecorderLabels } from '@/lib/robots-recorder';
import PageHeader from '@/components/ui/PageHeader';

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
    <div className="app-page ui-page ui-page-narrow robots-recorder">
      <PageHeader back={{ href: '/app/robots', label: t('back') }} title={t('title')} description={t('subtitle')} />

      <section className="robots-recorder-drag" aria-labelledby="recorder-drag">
        <h2 className="sr-only" id="recorder-drag">
          {t('bookmarklet')}
        </h2>
        <a ref={linkRef} className="btn btn-primary robots-bookmarklet" draggable onClick={(e) => e.preventDefault()} title={t('dragHint')}>
          {t('bookmarklet')}
        </a>
        <p>{t('dragHint')}</p>
      </section>

      <section className="robots-block" aria-labelledby="recorder-how">
        <h2 className="ui-section-title" id="recorder-how">
          {t('howTitle')}
        </h2>
        <ol className="robots-steplist robots-howto">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((k, i) => (
            <li key={k} className="robots-step">
              <div className="robots-step-head">
                <span className="robots-step-num data">{i + 1}</span>
                <p className="robots-howto-text">{t(k)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="robots-block" aria-labelledby="recorder-selectors">
        <h2 className="ui-section-title" id="recorder-selectors">
          {t('selectorsTitle')}
        </h2>
        <p className="robots-lead">{t('selectors')}</p>
        <p className="robots-lead">{t('passwords', { placeholder: PASSWORD_PLACEHOLDER })}</p>
      </section>

      <section className="robots-block" aria-labelledby="recorder-code">
        <h2 className="ui-section-title" id="recorder-code">
          {t('codeTitle')}
        </h2>
        <p className="robots-lead">{t('copyCodeHint')}</p>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => void copyCode()}>
            {copied ? t('copied') : t('copyCode')}
          </button>
          <span className="sr-only" role="status">
            {copied ? t('copied') : ''}
          </span>
        </div>
      </section>
    </div>
  );
}
