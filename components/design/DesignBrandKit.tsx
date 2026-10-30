'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import FormSection from '@/components/ui/FormSection';
import { DESIGN_FONTS } from '@/lib/design-fonts';
import { FONT_KEYS, isColor, type FontKey } from '@/lib/design-model';
import type { BrandKit, DesignFileDto } from '@/lib/design';
import { fileHref } from './PageSvg';
import { fontFamily } from './fonts';
import { shrinkForUpload } from './shrink';
import { ColorField, G, Glyph } from './ui';

type FontSlot = 'heading' | 'subheading' | 'body';

/** Kit de marca: colores, fuentes y logos del workspace. */
export default function DesignBrandKit({ initial, canEdit }: { initial: BrandKit; canEdit: boolean }) {
  const t = useTranslations('design.brand');
  const [colors, setColors] = useState(initial.colors);
  const [fonts, setFonts] = useState(initial.fonts);
  const [logos, setLogos] = useState<DesignFileDto[]>(initial.logos);
  const [newColor, setNewColor] = useState('#00a5c8');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const touch = () => {
    setDirty(true);
    setStatus(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/design/brand', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ colors, fonts, logos: logos.map((l) => l.id) }),
      });
      if (!r.ok) throw new Error('save');
      const d = (await r.json()) as { brand: BrandKit };
      setColors(d.brand.colors);
      setFonts(d.brand.fonts);
      setLogos(d.brand.logos);
      setDirty(false);
      setStatus(t('saved'));
    } catch {
      setError(t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (files: File[]) => {
    setBusy(true);
    setError(null);
    for (const f of files.slice(0, 12 - logos.length)) {
      const form = new FormData();
      form.append('file', await shrinkForUpload(f));
      form.append('kind', 'logo');
      const r = await fetch('/api/design/files', { method: 'POST', body: form }).catch(() => null);
      if (r?.ok) {
        const d = (await r.json()) as { file: DesignFileDto };
        setLogos((cur) => [...cur, d.file]);
        touch();
      } else setError(t('uploadError'));
    }
    setBusy(false);
  };

  return (
    <div className="app-page ui-page ui-page-narrow dz-brand" data-testid="design-brand">
      <PageHeader
        title={t('title')}
        description={canEdit ? t('lead') : t('readOnly')}
        back={{ href: '/app/design', label: 'Design' }}
        actions={
          canEdit ? (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !dirty} data-testid="design-brand-save">
              {t('save')}
            </button>
          ) : undefined
        }
      />
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <FormSection title={t('colors')} description={t('colorsHelp')}>
        {colors.length ? (
          <ul className="dz-brand-colors">
            {colors.map((c) => (
              <li key={c}>
                <span className="dz-swatch is-static" style={{ background: c }} aria-hidden="true" />
                <span className="data">{c}</span>
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm dz-tool"
                    aria-label={t('removeColor', { color: c })}
                    onClick={() => {
                      setColors((cur) => cur.filter((x) => x !== c));
                      touch();
                    }}
                  >
                    <Glyph d={G.close} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('noColors')}</p>
        )}
        {canEdit && (
          <div className="dz-brand-add">
            <ColorField label={t('newColor')} value={newColor} onChange={setNewColor} testId="design-brand-color" />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!isColor(newColor) || colors.includes(newColor.toLowerCase()) || colors.length >= 24}
              onClick={() => {
                setColors((cur) => [...cur, newColor.toLowerCase()]);
                touch();
              }}
              data-testid="design-brand-add-color"
            >
              {t('addColor')}
            </button>
          </div>
        )}
      </FormSection>

      <FormSection title={t('fonts')} description={t('fontsHelp')}>
        <div className="dz-brand-fonts">
          {(['heading', 'subheading', 'body'] as FontSlot[]).map((slot) => (
            <label key={slot} className="ui-field">
              <span className="label">{t(`slot.${slot}`)}</span>
              <select
                className="select"
                value={fonts[slot] ?? ''}
                disabled={!canEdit}
                onChange={(e) => {
                  setFonts((cur) => ({ ...cur, [slot]: (e.target.value || null) as FontKey | null }));
                  touch();
                }}
              >
                <option value="">{t('noFont')}</option>
                {FONT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {DESIGN_FONTS[k].label}
                  </option>
                ))}
              </select>
              {fonts[slot] && (
                <span className="dz-brand-font-sample" style={{ fontFamily: fontFamily(fonts[slot]!), fontWeight: slot === 'heading' ? 800 : slot === 'subheading' ? 600 : 400 }}>
                  {t(`sample.${slot}`)}
                </span>
              )}
            </label>
          ))}
        </div>
      </FormSection>

      <FormSection title={t('logos')} description={t('logosHelp')}>
        {logos.length ? (
          <ul className="dz-brand-logos">
            {logos.map((l) => (
              <li key={l.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileHref(l.id)} alt={l.name} />
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setLogos((cur) => cur.filter((x) => x.id !== l.id));
                      touch();
                    }}
                  >
                    {t('removeLogo')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('noLogos')}</p>
        )}
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length) void uploadLogo(files);
              }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={busy || logos.length >= 12}>
              {t('uploadLogo')}
            </button>
          </>
        )}
      </FormSection>
    </div>
  );
}
