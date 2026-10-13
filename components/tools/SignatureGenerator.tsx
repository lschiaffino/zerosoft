'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  renderSignature,
  signatureText,
  SIGNATURE_TEMPLATES,
  SOCIAL_KEYS,
  SOCIAL_NAMES,
  type SignatureData,
  type SignatureTemplate,
} from '@/lib/tools/signature';
import { Field, readLocal, useCopy, writeLocal } from './shared';

const STORAGE_KEY = 'zs-tools-signature';

const ACCENTS = ['#0d0d0d', '#2f6bff', '#7b4dff', '#0e9f6e', '#f2611d', '#e23d7f'];

/** Copia HTML enriquecido (para pegar en Gmail/Outlook) con fallbacks. */
async function copyRich(html: string, text: string, node: HTMLElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    /* sigue con el fallback */
  }
  try {
    if (node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      const ok = document.execCommand('copy');
      sel?.removeAllRanges();
      if (ok) return true;
    }
  } catch {
    /* sigue */
  }
  try {
    await navigator.clipboard.writeText(html);
    return true;
  } catch {
    return false;
  }
}

export default function SignatureGenerator() {
  const t = useTranslations('tools.signature');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const [data, setData] = useState<SignatureData>(() => ({
    name: t('sample.name'),
    title: t('sample.title'),
    company: t('sample.company'),
    phone: '+1 555 010 2030',
    email: 'alex@acme.com',
    website: 'acme.com',
    photoUrl: '',
    accent: '#2f6bff',
    meetingUrl: '',
    socials: { linkedin: '' },
  }));
  const [template, setTemplate] = useState<SignatureTemplate>('classic');
  const { copied, copy, flash } = useCopy();
  const previewRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const loaded = useRef(false);

  useEffect(() => {
    const saved = readLocal<{ data: SignatureData; template: SignatureTemplate }>(STORAGE_KEY);
    if (saved?.data) setData((d) => ({ ...d, ...saved.data, socials: { ...saved.data.socials } }));
    if (saved?.template && SIGNATURE_TEMPLATES.includes(saved.template)) setTemplate(saved.template);
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (loaded.current) writeLocal(STORAGE_KEY, { data, template });
  }, [data, template]);

  const set = (k: keyof Omit<SignatureData, 'socials'>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setData((d) => ({ ...d, [k]: e.target.value }));

  const html = useMemo(
    () => Object.fromEntries(SIGNATURE_TEMPLATES.map((tp) => [tp, renderSignature(tp, data, locale)])) as Record<SignatureTemplate, string>,
    [data, locale],
  );

  const onCopyRich = async () => {
    const ok = await copyRich(html[template], signatureText(data, locale), previewRefs.current[template]);
    if (ok) flash('rich');
  };

  return (
    <div className="tl-split">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <div className="tl-grid">
          <Field label={t('fields.name')}>
            <input className="input" value={data.name} onChange={set('name')} autoComplete="name" />
          </Field>
          <Field label={t('fields.title')}>
            <input className="input" value={data.title} onChange={set('title')} autoComplete="organization-title" />
          </Field>
          <Field label={t('fields.company')}>
            <input className="input" value={data.company} onChange={set('company')} autoComplete="organization" />
          </Field>
          <Field label={t('fields.phone')}>
            <input className="input" value={data.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" />
          </Field>
          <Field label={t('fields.email')}>
            <input className="input" value={data.email} onChange={set('email')} autoComplete="email" inputMode="email" />
          </Field>
          <Field label={t('fields.website')}>
            <input className="input" value={data.website} onChange={set('website')} inputMode="url" />
          </Field>
          <Field label={t('fields.photoUrl')} hint={t('hints.photoUrl')} wide>
            <input className="input" value={data.photoUrl} onChange={set('photoUrl')} inputMode="url" placeholder="https://…/photo.jpg" />
          </Field>
          <Field label={t('fields.meetingUrl')} hint={t('hints.meetingUrl')} wide>
            <input
              className="input"
              value={data.meetingUrl}
              onChange={set('meetingUrl')}
              inputMode="url"
              placeholder="zerosoft.ai/book/you"
            />
          </Field>
        </div>

        <fieldset className="tl-fieldset">
          <legend className="label">{t('fields.accent')}</legend>
          <div className="tl-swatches">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                className={`tl-swatch${data.accent.toLowerCase() === c ? ' is-on' : ''}`}
                style={{ background: c }}
                aria-label={c}
                aria-pressed={data.accent.toLowerCase() === c}
                onClick={() => setData((d) => ({ ...d, accent: c }))}
              />
            ))}
            <input
              type="color"
              className="tl-color"
              value={/^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : '#0d0d0d'}
              onChange={set('accent')}
              aria-label={t('fields.customColor')}
            />
          </div>
        </fieldset>

        <details className="tl-details">
          <summary>{t('fields.socials')}</summary>
          <div className="tl-grid">
            {SOCIAL_KEYS.map((k) => (
              <Field key={k} label={SOCIAL_NAMES[k]}>
                <input
                  className="input"
                  value={data.socials[k] ?? ''}
                  inputMode="url"
                  placeholder={`${k === 'x' ? 'x' : k}.com/…`}
                  onChange={(e) => setData((d) => ({ ...d, socials: { ...d.socials, [k]: e.target.value } }))}
                />
              </Field>
            ))}
          </div>
        </details>
      </form>

      <div className="tl-output">
        <div className="tl-templates" role="radiogroup" aria-label={t('templates')}>
          {SIGNATURE_TEMPLATES.map((tp) => (
            <div
              key={tp}
              role="radio"
              tabIndex={0}
              aria-checked={template === tp}
              className={`tl-template${template === tp ? ' is-on' : ''}`}
              onClick={() => setTemplate(tp)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setTemplate(tp);
                }
              }}
            >
              <span className="tl-template-name mono">{t(`templateNames.${tp}`)}</span>
              <div
                className="tl-sig-preview"
                ref={(el) => {
                  previewRefs.current[tp] = el;
                }}
                // HTML generado por renderSignature: todo valor escapado y URLs filtradas.
                dangerouslySetInnerHTML={{ __html: html[tp] }}
              />
            </div>
          ))}
        </div>
        <div className="tl-actions">
          <button type="button" className="btn btn-solid btn-small" onClick={onCopyRich}>
            {copied === 'rich' ? tc('copied') : t('copySignature')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => copy(html[template], 'html')}>
            {copied === 'html' ? tc('copied') : t('copyHtml')}
          </button>
        </div>
        <details className="tl-details">
          <summary>{t('install.title')}</summary>
          <ul className="tl-steps">
            <li>
              <strong>Gmail</strong> — {t('install.gmail')}
            </li>
            <li>
              <strong>Outlook</strong> — {t('install.outlook')}
            </li>
            <li>
              <strong>Apple Mail</strong> — {t('install.apple')}
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}
