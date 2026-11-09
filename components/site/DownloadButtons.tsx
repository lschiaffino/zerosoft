'use client';

import { useEffect, useState } from 'react';
import { detectDesktopOs, downloadHref, type DesktopOs } from '@/lib/desktop-os';

interface Props {
  locale: string;
  /** Qué instaladores tiene el último release (si falta uno, no se ofrece). */
  links: { macArm64: string | null; macX64: string | null; win: string | null };
  labels: { macArm: string; macIntel: string; win: string; otherMac: string; otherArm: string };
}

/**
 * Botones de /download: el grande es el del sistema de quien mira. Cada uno
 * pasa por /api/desktop/download (cuenta el clic) y termina en
 * /download/start, que baja el instalador y muestra cómo abrirlo.
 */
export default function DownloadButtons({ locale, links, labels }: Props) {
  const [os, setOs] = useState<DesktopOs | 'mobile' | 'other' | null>(null);

  useEffect(() => {
    let alive = true;
    void detectDesktopOs().then((v) => {
      if (alive) setOs(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const href = (key: DesktopOs) => downloadHref('download', { os: key, locale });
  const all = [
    { key: 'mac-arm' as const, ok: links.macArm64, label: labels.macArm },
    { key: 'mac-intel' as const, ok: links.macX64, label: labels.macIntel },
    { key: 'win' as const, ok: links.win, label: labels.win },
  ].filter((b) => b.ok);
  const primary = all.find((b) => b.key === os) ?? null;
  const rest = primary ? all.filter((b) => b !== primary) : all;
  const isMac = os === 'mac-arm' || os === 'mac-intel';
  const macHint = os === 'mac-arm' ? links.macX64 && { key: 'mac-intel' as const, label: labels.otherMac } : os === 'mac-intel' ? links.macArm64 && { key: 'mac-arm' as const, label: labels.otherArm } : null;

  return (
    <div className="dl-buttons" data-os={os ?? ''}>
      <div className="read-actions">
        {primary && (
          <a className="btn btn-primary btn-lg" href={href(primary.key)} rel="nofollow" data-testid="download-primary">
            {primary.label}
          </a>
        )}
        {(primary ? rest.filter((b) => !b.key.startsWith('mac') || !isMac) : rest).map((b) => (
          <a key={b.key} className={`btn ${primary ? 'btn-secondary' : 'btn-primary'} btn-lg`} href={href(b.key)} rel="nofollow" data-testid={`download-${b.key}`}>
            {b.label}
          </a>
        ))}
      </div>
      {macHint && (
        <p className="read-meta">
          <a href={href(macHint.key)} rel="nofollow">
            {macHint.label}
          </a>
        </p>
      )}
    </div>
  );
}
