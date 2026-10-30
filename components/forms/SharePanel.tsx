'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import type { FormDto } from '@/lib/forms/core';
import { Field } from './BuildPanel';

/** Link público, embed (iframe, script en línea y popup) y QR. */
export default function SharePanel({ form, slug, onSlug }: { form: FormDto; slug: string; onSlug: (v: string) => void }) {
  const t = useTranslations('forms.share');
  const locale = useLocale();
  const [origin, setOrigin] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState('');
  const url = `${origin}/${form.definition.lang || locale}/f/${form.slug}`;

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!origin) return;
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [origin, url]);

  const snippets = {
    link: url,
    iframe: `<iframe src="${url}?embed=1" title="${form.name.replace(/"/g, '&quot;')}" style="width:100%;height:560px;border:0" loading="lazy"></iframe>`,
    script: `<script src="${origin}/api/forms/embed.js" data-form="${form.slug}" data-locale="${form.definition.lang}" async></script>`,
    popup: `<script src="${origin}/api/forms/embed.js" data-form="${form.slug}" data-locale="${form.definition.lang}" data-mode="popup" data-button="${t('popupButton')}" async></script>`,
  };
  const copy = async (key: keyof typeof snippets) => {
    try {
      await navigator.clipboard.writeText(snippets[key]);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  };

  return (
    <div className="ui-fields fm-share">
      {form.status !== 'published' && (
        <p className="fm-msg fm-msg-warn" role="status">
          {form.status === 'draft' ? t('draftNote') : t('closedNote')}
        </p>
      )}
      <Field label={t('link')} id="fm-share-link">
        <div className="fm-copy-row">
          <input id="fm-share-link" className="input mono" readOnly value={snippets.link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy('link')}>
            {copied === 'link' ? t('copied') : t('copy')}
          </button>
          {form.status === 'published' && (
            <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noopener noreferrer">
              {t('open')}
            </a>
          )}
        </div>
      </Field>
      <Field label={t('slug')} id="fm-slug" help={t('slugHelp')}>
        <input id="fm-slug" className="input mono" value={slug} maxLength={62} onChange={(e) => onSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
      </Field>
      {(['iframe', 'script', 'popup'] as const).map((k) => (
        <Field key={k} label={t(`embed.${k}`)} id={`fm-share-${k}`} help={t(`embed.${k}Help`)}>
          <div className="fm-copy-row">
            <textarea id={`fm-share-${k}`} className="textarea mono fm-snippet" readOnly rows={2} value={snippets[k]} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(k)}>
              {copied === k ? t('copied') : t('copy')}
            </button>
          </div>
        </Field>
      ))}
      <div className="fm-qr">
        <p className="label">{t('qr')}</p>
        {qr ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} width={160} height={160} alt={t('qrAlt', { name: form.name })} />
            <a className="btn btn-ghost btn-sm" href={qr} download={`${form.slug}-qr.png`}>
              {t('qrDownload')}
            </a>
          </>
        ) : (
          <span className="ui-skeleton fm-qr-skel" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
