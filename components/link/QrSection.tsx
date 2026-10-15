'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_QR_STYLE, hasEnoughContrast, QR_DOTS, renderQrSvg, type QrStyle } from '@/lib/link-qr-render';

interface QrSectionProps {
  id: string;
  slug: string;
}

const MAX_LOGO_BYTES = 200 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function download(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** QR con marca: colores, módulos, logo. Vista previa en vivo y descarga SVG/PNG. */
export default function QrSection({ id, slug }: QrSectionProps) {
  const t = useTranslations('link');
  const [target, setTarget] = useState<string | null>(null);
  const [style, setStyle] = useState<QrStyle>(DEFAULT_QR_STYLE);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/links/${id}/qr?format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { style: QrStyle; target: string } | null) => {
        if (cancelled || !data) return;
        setTarget(data.target);
        setStyle(data.style);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [id]);

  const svg = useMemo(() => (target ? renderQrSvg(target, style) : null), [target, style]);
  const svgUrl = useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null), [svg]);

  function update(patch: Partial<QrStyle>) {
    setSaved(false);
    setStyle((s) => ({ ...s, ...patch }));
  }

  function onLogo(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setError(t('qr.logoType'));
    if (file.size > MAX_LOGO_BYTES) return setError(t('qr.logoTooBig'));
    const reader = new FileReader();
    reader.onload = () => update({ logo: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/links/${id}/qr`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(style),
    });
    setSaving(false);
    if (res.ok) setSaved(true);
    else setError(t('errors.generic'));
  }

  function downloadPng() {
    if (!svgUrl) return;
    const img = new Image();
    img.onload = () => {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      download(canvas.toDataURL('image/png'), `${slug}-qr.png`);
    };
    img.src = svgUrl;
  }

  const lowContrast = !hasEnoughContrast(style.fg, style.bg);

  return (
    <div className="qr-section">
      <div className="qr-box" aria-label={t('qr.previewAria')} data-testid="qr-preview">
        {svg ? (
          // SVG armado en el cliente con nuestra propia URL corta; el logo es un data URL raster validado.
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className="qr-loading mono">000</span>
        )}
      </div>

      <div className="qr-design">
        <p className="section-label">{t('qr.design')}</p>
        <div className="qr-controls">
          <label className="qr-color mono">
            <input type="color" value={style.fg} onChange={(e) => update({ fg: e.target.value })} aria-label={t('qr.fg')} />
            {t('qr.fg')}
          </label>
          <label className="qr-color mono">
            <input type="color" value={style.bg} onChange={(e) => update({ bg: e.target.value })} aria-label={t('qr.bg')} />
            {t('qr.bg')}
          </label>
          <label className="qr-select mono">
            {t('qr.dots')}
            <select className="input" value={style.dots} onChange={(e) => update({ dots: e.target.value as QrStyle['dots'] })}>
              {QR_DOTS.map((d) => (
                <option key={d} value={d}>
                  {t(d === 'square' ? 'qr.dotsSquare' : d === 'rounded' ? 'qr.dotsRounded' : 'qr.dotsDots')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qr-controls">
          <label className="btn btn-ghost btn-small qr-upload">
            {t('qr.uploadLogo')}
            <input
              type="file"
              accept={LOGO_TYPES.join(',')}
              onChange={(e) => onLogo(e.target.files?.[0])}
              data-testid="qr-logo-input"
            />
          </label>
          {style.logo && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => update({ logo: null })}>
              {t('qr.removeLogo')}
            </button>
          )}
        </div>
        <p className="field-hint">{t('qr.logoHint')}</p>
        {lowContrast && <p className="qr-warn">{t('qr.lowContrast')}</p>}
        {error && (
          <p className="qr-warn" role="alert">
            {error}
          </p>
        )}
        {target && <p className="field-hint mono qr-note">{t('qr.scansNote', { url: target })}</p>}
      </div>

      <div className="qr-actions">
        <button type="button" className="btn btn-small" onClick={() => void save()} disabled={saving}>
          {saved ? t('qr.saved') : t('qr.save')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={!svgUrl}
          onClick={() => svgUrl && download(svgUrl, `${slug}-qr.svg`)}
        >
          {t('detail.downloadSvg')}
        </button>
        <button type="button" className="btn btn-ghost btn-small" disabled={!svgUrl} onClick={downloadPng}>
          {t('detail.downloadPng')}
        </button>
      </div>
    </div>
  );
}
