'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Field, useCopy } from './shared';

const KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;
type UtmKey = (typeof KEYS)[number];

const PRESETS: Array<{ id: string; v: Partial<Record<UtmKey, string>> }> = [
  { id: 'newsletter', v: { source: 'newsletter', medium: 'email' } },
  { id: 'linkedin', v: { source: 'linkedin', medium: 'social' } },
  { id: 'google', v: { source: 'google', medium: 'cpc' } },
  { id: 'signature', v: { source: 'email-signature', medium: 'email' } },
];

/** Normaliza valores UTM: minúsculas y guiones (evita "Email" vs "email" en analytics). */
function clean(v: string, normalize: boolean): string {
  const s = v.trim();
  return normalize ? s.toLowerCase().replace(/\s+/g, '-') : s;
}

export function buildUtmUrl(base: string, params: Partial<Record<UtmKey, string>>, normalize = true): string {
  const raw = base.trim();
  if (!raw) return '';
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  for (const k of KEYS) {
    const v = clean(params[k] ?? '', normalize);
    if (v) u.searchParams.set(`utm_${k}`, v);
    else u.searchParams.delete(`utm_${k}`);
  }
  return u.toString();
}

export default function UtmBuilder() {
  const t = useTranslations('tools.utm');
  const tc = useTranslations('tools.common');
  const [base, setBase] = useState('');
  const [p, setP] = useState<Record<UtmKey, string>>({ source: '', medium: '', campaign: '', term: '', content: '' });
  const [normalize, setNormalize] = useState(true);
  const { copied, copy } = useCopy();
  const out = useMemo(() => buildUtmUrl(base, p, normalize), [base, p, normalize]);
  const missing = out && (!p.source.trim() || !p.medium.trim() || !p.campaign.trim());

  return (
    <div className="tl-split">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <Field label={t('url')} wide>
          <input className="input" inputMode="url" placeholder="https://yoursite.com/pricing" value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <div className="tl-presets">
          <span className="label">{t('presets')}</span>
          {PRESETS.map((pr) => (
            <button key={pr.id} type="button" className="tl-seg-btn" onClick={() => setP((cur) => ({ ...cur, ...pr.v }))}>
              {t(`presetNames.${pr.id}`)}
            </button>
          ))}
        </div>
        <div className="tl-grid">
          {KEYS.map((k) => (
            <Field key={k} label={`utm_${k}${k === 'term' || k === 'content' ? ` · ${t('optional')}` : ''}`} hint={t(`hints.${k}`)}>
              <input className="input" value={p[k]} onChange={(e) => setP((cur) => ({ ...cur, [k]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <label className="tl-check">
          <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
          {t('normalize')}
        </label>
      </form>
      <div className="tl-output">
        <p className="label">{t('result')}</p>
        <p className="tl-code mono">{out || t('empty')}</p>
        {missing && <p className="tl-notice">{t('missing')}</p>}
        <div className="tl-actions">
          <button type="button" className="btn btn-solid btn-small" disabled={!out} onClick={() => copy(out, 'url')}>
            {copied === 'url' ? tc('copied') : tc('copy')}
          </button>
        </div>
        <p className="tl-hint">{t('shortenHint')}</p>
      </div>
    </div>
  );
}
