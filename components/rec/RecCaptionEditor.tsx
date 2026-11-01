'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { captionLangName, MAX_REC_CAPTION_TRACKS, REC_CAPTION_LANGS, REC_CAPTION_LOOKS, REC_CAPTION_POSITIONS, REC_CAPTION_SIZES, type RecCaptionStyle } from '@/lib/rec-schema';

/** Estilo y traducciones de los subtítulos del video. Se ven en la app, en la página compartida y al insertar. */
export default function RecCaptionEditor({
  videoId,
  style,
  langs,
  sourceLang,
  hasTranscript,
  busy,
  onStyle,
  onLangs,
}: {
  videoId: string;
  style: RecCaptionStyle;
  langs: string[];
  sourceLang: string | null;
  hasTranscript: boolean;
  busy: boolean;
  onStyle: (next: RecCaptionStyle) => void;
  onLangs: (next: string[]) => void;
}) {
  const t = useTranslations('rec.captions');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const [lang, setLang] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = REC_CAPTION_LANGS.filter((l) => !langs.includes(l) && l !== sourceLang);

  async function call(init: RequestInit, query = '') {
    setWorking(true);
    setError(null);
    const res = await fetch(`/api/rec/videos/${videoId}/captions${query}`, init).catch(() => null);
    setWorking(false);
    if (!res?.ok) {
      const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic';
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.generic'));
      return;
    }
    onLangs(((await res.json()) as { langs: string[] }).langs);
    setLang('');
  }

  return (
    <section className="rec-edit-block" data-testid="rec-captions">
      <h2 className="rec-h">{t('title')}</h2>
      <p className="ui-help">{t('help')}</p>
      <div className="ui-fields rec-caption-fields">
        <div className="ui-field">
          <label className="label" htmlFor="rec-cap-size">
            {t('size')}
          </label>
          <select id="rec-cap-size" className="select" value={style.size} disabled={busy} onChange={(e) => onStyle({ ...style, size: e.target.value as RecCaptionStyle['size'] })} data-testid="rec-cap-size">
            {REC_CAPTION_SIZES.map((v) => (
              <option key={v} value={v}>
                {t(`sizes.${v}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="rec-cap-look">
            {t('look')}
          </label>
          <select id="rec-cap-look" className="select" value={style.look} disabled={busy} onChange={(e) => onStyle({ ...style, look: e.target.value as RecCaptionStyle['look'] })} data-testid="rec-cap-look">
            {REC_CAPTION_LOOKS.map((v) => (
              <option key={v} value={v}>
                {t(`looks.${v}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="rec-cap-pos">
            {t('position')}
          </label>
          <select id="rec-cap-pos" className="select" value={style.position} disabled={busy} onChange={(e) => onStyle({ ...style, position: e.target.value as RecCaptionStyle['position'] })} data-testid="rec-cap-position">
            {REC_CAPTION_POSITIONS.map((v) => (
              <option key={v} value={v}>
                {t(`positions.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <h3 className="rec-h rec-h-sub">{t('translations')}</h3>
      {!hasTranscript ? (
        <p className="ui-help" data-testid="rec-captions-need-transcript">
          {t('needTranscript')}
        </p>
      ) : (
        <>
          <p className="ui-help">{t('translationsHelp')}</p>
          {langs.length > 0 ? (
            <ul className="rec-caption-langs">
              {langs.map((l) => (
                <li key={l} className="rec-caption-lang" data-testid="rec-caption-track">
                  <span>{captionLangName(l, locale)}</span>
                  <button type="button" className="btn btn-ghost btn-danger btn-sm" disabled={working} onClick={() => void call({ method: 'DELETE' }, `?lang=${l}`)}>
                    {t('remove')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-help">{t('noTranslations')}</p>
          )}
          <div className="ui-input-group rec-caption-add">
            <select className="select" value={lang} aria-label={t('language')} disabled={working || langs.length >= MAX_REC_CAPTION_TRACKS} onChange={(e) => setLang(e.target.value)} data-testid="rec-caption-pick">
              <option value="">{t('pick')}</option>
              {options.map((l) => (
                <option key={l} value={l}>
                  {captionLangName(l, locale)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!lang || working}
              onClick={() => void call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang }) })}
              data-testid="rec-caption-translate"
            >
              {working ? t('translating') : t('translate')}
            </button>
          </div>
          {langs.length >= MAX_REC_CAPTION_TRACKS && <p className="ui-help">{t('limit', { n: MAX_REC_CAPTION_TRACKS })}</p>}
        </>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
