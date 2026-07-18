'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface QrSectionProps {
  id: string;
  slug: string;
}

/** Inline SVG QR + SVG/PNG download buttons. */
export default function QrSection({ id, slug }: QrSectionProps) {
  const t = useTranslations('link');
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/links/${id}/qr?format=svg`)
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => {
        if (!cancelled) setSvg(text);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="qr-section">
      <div className="qr-box" aria-label="QR code">
        {svg ? (
          // SVG is generated server-side by the qrcode package for our own short URL.
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className="qr-loading mono">000</span>
        )}
      </div>
      <div className="qr-actions">
        <a className="btn btn-ghost btn-small" href={`/api/links/${id}/qr?format=svg`} download={`${slug}.svg`}>
          {t('detail.downloadSvg')}
        </a>
        <a className="btn btn-ghost btn-small" href={`/api/links/${id}/qr?format=png`}>
          {t('detail.downloadPng')}
        </a>
      </div>
    </div>
  );
}
